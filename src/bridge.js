// dsh-remote 桥接核心：DSH 事件流 ↔ 手机（经 Vercel 加密离线信箱）
import { randomBytes } from "node:crypto";
import { DshClient } from "./dsh-client.js";
import { startRelay } from "./vercel-relay.js";
import { UsageReader } from "./usage.js";

const PUSH_CHUNK = 5500;
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HELP_TEXT = [
  "DSH 远程助手 — 手机指令",
  "直接发文字：作为用户消息发给当前会话（排队执行）",
  "/steer <文字>：干预消息（steer 模式）",
  "/status     当前会话与主机状态",
  "/sessions   列出所有会话",
  "/use <ID后缀> 切换当前会话（如 /use a3a4）",
  "/history [n] 最近 n 条对话摘要（默认 6）",
  "/new [目录]  新建会话（默认使用 DSH 当前目录）",
  "/queue      查看当前会话排队消息",
  "/drop <ID后缀> 删除一条排队消息",
  "/model      查看当前模型",
  "/pending    查看尚未处理的审批与提问",
  "/stop       中断当前会话正在进行的回合",
  "/mute | /unmute   静音/取消（静音后仍推审批与提问）",
  "/verbose | /quiet 详细/简洁事件推送",
].join("\n");

function blockText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function shortId(id) {
  return String(id ?? "").slice(-8);
}

function newRef(prefix) {
  return `${prefix}-${randomBytes(6).toString("base64url")}`;
}

export class RemoteBridge {
  constructor({ config, statePath, logger = console, usageReader }) {
    this.cfg = config;
    this.statePath = statePath;
    this.logger = logger;
    this.client = new DshClient(config.dshUrl, {
      onFrame: (f) => this.onFrame(f),
      onStatus: (s) => this.logStatus(s),
      logger,
    });
    this.relay = null;
    this.sessions = new Map(); // id -> {title, running, updatedAt, cwd, blank}
    this.currentSessionId = null;
    this.userChosen = false; // 手机端是否显式 /use 过（显式选择优先于自动偏好）
    this.muted = false;
    this.verbose = false;
    this.pendingApprovals = new Map(); // ref -> {rpcId, sessionId, approvalId, ts}
    this.pendingQuestions = new Map(); // ref -> {rpcId, sessionId, ts}
    this.recentPhoneMessages = []; // {sessionId, text, ts}
    this.lastJobStates = new Map();
    this.lastQueues = new Map();
    this.pruneTimer = null;
    this.helloTimer = null;
    this.instanceId = randomBytes(12).toString("base64url");
    this.presenceCheck = null;
    this.usage = usageReader || new UsageReader(config.usage?.script);
    this.usageReplies = new Map();
  }

  /* ---------------- 生命周期 ---------------- */

  async start() {
    this.relay = startRelay(this.cfg.relay, {
      onEnvelope: (env) => this.onEnvelope(env),
      onStatus: (s) => this.logStatus(s),
      logger: this.logger,
      statePath: this.statePath,
      idlePollMs: this.cfg.relay.idlePollMs,
      activePollMs: this.cfg.relay.activePollMs,
    });
    this.client.start();
    this.pruneTimer = setInterval(() => this.prunePendings(), 60_000);
    try {
      await this.refreshSessions();
    } catch (err) {
      this.logger.warn(`初始会话刷新失败: ${err.message}`);
    }
    this.logger.log("dsh-remote 桥接已启动，等待连接…");
  }

  stop() {
    this.usage.close();
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (this.helloTimer) clearTimeout(this.helloTimer);
    this.client.stop();
    this.relay?.close();
    this.logger.log("dsh-remote 已停止");
  }

  logStatus(s) {
    const relayNames = {
      "relay-up": "Vercel 中继已连接",
      "relay-offline": "Vercel 中继暂不可用（自动重试中）",
      "mux-open": "DSH 事件流已连接",
      "mux-close": "DSH 事件流断开（自动重连中）",
    };
    if (s.startsWith("relay-error:") || s.startsWith("mux-error")) {
      this.logger.warn(`[桥接] ${s}`);
    } else if (relayNames[s]) {
      this.logger.log(`[桥接] ${relayNames[s]}`);
    } else if (!s.startsWith("mux-reconnect") && !s.startsWith("relay-reconnect")) {
      this.logger.log(`[桥接] ${s}`);
    }
  }

  /* ---------------- DSH 帧分发 ---------------- */

  onFrame(frame) {
    const { rpcId, payload } = frame;
    switch (payload.type) {
      case "session/subscribed": {
        this.rememberSession(payload.sessionId);
        if (!this.currentSessionId) this.currentSessionId = payload.sessionId;
        this.scheduleHello();
        break;
      }
      case "session/event":
        this.onSessionEvent(payload);
        break;
      case "approval/requested":
        this.onApprovalRequested(rpcId, payload);
        break;
      case "approval/resolved":
        this.onApprovalResolved(payload);
        break;
      case "question/requested":
        this.onQuestionRequested(rpcId, payload);
        break;
      case "question/resolved":
        this.onQuestionResolved(payload);
        break;
      case "session/jobs":
        this.onJobs(payload);
        break;
      case "session/queue":
        this.onQueue(payload);
        break;
      case "stream/error":
        this.pushNotice("error", `DSH 流错误: ${payload.error?.message ?? "unknown"}`);
        break;
      default:
        break;
    }
  }

  onSessionEvent(payload) {
    const sessionId = payload.sessionId;
    this.rememberSession(sessionId);
    const event = payload.event ?? {};
    const data = event.data ?? {};
    const isCurrent = sessionId === this.currentSessionId;
    const interesting = isCurrent || this.cfg.push.otherSessions === true;

    switch (event.type) {
      case "user/message": {
        if (data.source?.kind === "plugin") break; // 系统注入，不推
        const text = blockText(data.content);
        if (!text) break;
        if (this.isRecentPhoneMessage(sessionId, text)) break; // 不回声
        if (interesting) this.pushChat("user", text, sessionId);
        break;
      }
      case "turn/start": {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.running = true;
          session.updatedAt = Date.now();
        }
        this.scheduleHello();
        break;
      }
      case "turn/end": {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.running = false;
          session.updatedAt = Date.now();
        }
        this.scheduleHello();
        break;
      }
      case "session/title": {
        const session = this.sessions.get(sessionId);
        if (session && typeof data.title === "string") session.title = data.title;
        this.scheduleHello();
        break;
      }
      case "assistant/message": {
        const text = blockText(data.message?.content);
        if (!text) break;
        if (interesting) this.pushChat("assistant", text, sessionId);
        break;
      }
      case "tool/call": {
        if (this.verbose && isCurrent) {
          this.pushNotice("info", `🔧 调用工具 ${data.toolName ?? "?"}`, sessionId);
        }
        break;
      }
      case "command/run": {
        if (this.verbose && isCurrent) {
          this.pushNotice("info", `⌘ 执行命令 ${data.name ?? "?"}`, sessionId);
        }
        break;
      }
      case "llm/retry": {
        if (isCurrent) this.pushNotice("warn", "模型请求重试中…", sessionId);
        break;
      }
      case "compaction/start": {
        if (isCurrent) this.pushNotice("info", "上下文压缩中…", sessionId);
        break;
      }
      case "compaction/summary": {
        if (isCurrent) this.pushNotice("info", "上下文压缩完成", sessionId);
        break;
      }
      case "sandbox/mode": {
        if (isCurrent) this.pushNotice("info", `沙箱模式 → ${data.mode}`, sessionId);
        break;
      }
      case "approval/policy": {
        if (isCurrent) this.pushNotice("info", `审批策略 → ${data.policy}`, sessionId);
        break;
      }
      case "goal/change": {
        if (isCurrent) this.pushNotice("info", `🎯 目标已更新`, sessionId);
        break;
      }
      case "todo/write": {
        if (this.verbose && isCurrent) this.pushNotice("info", "☑ 任务清单已更新", sessionId);
        break;
      }
      default:
        break; // turn/step/chunk/feedback/request 等噪音事件
    }
  }

  onApprovalRequested(rpcId, payload) {
    const duplicate = [...this.pendingApprovals.entries()].find(([, value]) => value.approvalId === payload.approvalId);
    const ref = duplicate?.[0] ?? newRef("a");
    this.pendingApprovals.set(ref, {
      rpcId,
      sessionId: payload.sessionId,
      approvalId: payload.approvalId,
      toolName: payload.toolName,
      reason: payload.reason,
      ts: Date.now(),
    });
    this.push(
      "approval",
      {
        ref,
        sessionId: payload.sessionId,
        sessionLabel: this.sessionLabel(payload.sessionId),
        toolName: payload.toolName,
        reason: payload.reason,
      },
      null,
      true,
    );
  }

  onApprovalResolved(payload) {
    for (const [ref, p] of this.pendingApprovals) {
      if (p.approvalId === payload.approvalId) {
        this.pendingApprovals.delete(ref);
        this.push("resolution", {
          ref,
          requestType: "approval",
          outcome: payload.outcome,
          sessionId: payload.sessionId,
          text: `审批 ${shortId(payload.approvalId)} → ${payload.outcome}`,
        }, null, true);
        break;
      }
    }
  }

  onQuestionRequested(rpcId, payload) {
    const duplicate = [...this.pendingQuestions.entries()].find(([, value]) => value.rpcId === rpcId);
    const ref = duplicate?.[0] ?? newRef("q");
    this.pendingQuestions.set(ref, {
      rpcId,
      sessionId: payload.sessionId,
      questions: payload.questions ?? [],
      ts: Date.now(),
    });
    this.push(
      "question",
      {
        ref,
        sessionId: payload.sessionId,
        sessionLabel: this.sessionLabel(payload.sessionId),
        questions: payload.questions,
      },
      null,
      true,
    );
  }

  onQuestionResolved(payload) {
    for (const [ref, p] of this.pendingQuestions) {
      if (p.rpcId === payload.questionRpcId) {
        this.pendingQuestions.delete(ref);
        this.push("resolution", {
          ref,
          requestType: "question",
          outcome: payload.outcome,
          sessionId: payload.sessionId,
          text: `提问已${payload.outcome === "answered" ? "回答" : "取消"}`,
        }, null, true);
        break;
      }
    }
  }

  onJobs(payload) {
    const prev = this.lastJobStates.get(payload.sessionId) ?? new Map();
    const next = new Map();
    const notices = [];
    for (const job of payload.jobs ?? []) {
      next.set(job.id, job.status);
      const old = prev.get(job.id);
      const label = job.label ?? job.kind ?? job.id;
      if (old === undefined && job.status === "running") notices.push(`⏳ ${label} 开始`);
      else if (old !== undefined && old !== job.status) {
        notices.push(`⏳ ${label}: ${old} → ${job.status}${job.detail ? `（${job.detail}）` : ""}`);
      }
    }
    for (const [id, st] of prev) {
      if (!next.has(id) && st === "running") notices.push(`⏳ 任务 ${shortId(id)} 已结束`);
    }
    this.lastJobStates.set(payload.sessionId, next);
    for (const n of notices) this.pushNotice("info", n, payload.sessionId);
  }

  onQueue(payload) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    this.lastQueues.set(payload.sessionId, items);
    if (payload.sessionId === this.currentSessionId && this.verbose) {
      this.pushNotice("info", `排队消息更新：${items.length} 条`, payload.sessionId);
    }
  }

  /* ---------------- 手机 → 电脑 ---------------- */

  onEnvelope(env) {
    const d = env.d ?? {};
    switch (env.k) {
      case "presence":
        return this.sendPresence(env);
      case "usage":
        // Slow balance queries must not delay chat, approval or presence handling.
        if (Number.isFinite(env.ts) && Math.abs(Date.now() - env.ts) < 60000 && this.usageReplies.size < 8 && !this.usageReplies.has(env.id)) {
          const task = this.usage.read().then(data => {
            if (!this.client.closed) return this.relay?.publishTransient("usage", data, env.id);
          }).catch(() => {}).finally(() => { this.usageReplies.delete(env.id); });
          this.usageReplies.set(env.id, task);
        }
        break;
      case "hello":
        this.sendHello().catch((err) => this.logger.warn(`sendHello 失败: ${err.message}`));
        break;
      case "msg":
        this.onPhoneMessage(d.text, d.mode);
        break;
      case "approval-answer":
        this.onApprovalAnswer(d.ref, d.outcome);
        break;
      case "question-answer":
        this.onQuestionAnswer(d.ref, d.answers, d.cancel === true);
        break;
      default:
        break;
    }
  }

  async sendPresence(env) {
    // Control probes expire quickly and never enter the durable business outbox.
    if (!Number.isFinite(env.ts) || Math.abs(Date.now() - env.ts) > 45000) return;
    if (!this.presenceCheck) {
      this.presenceCheck = this.client.rpc("host.describe", {}, { timeoutMs: 4000 })
        .then(() => this.client.ws?.readyState === 1 ? "ready" : "reconnecting")
        .catch(() => "unavailable")
        .finally(() => { this.presenceCheck = null; });
    }
    const dsh = await this.presenceCheck;
    if (this.client.closed) return;
    await this.relay?.publishPresence({ protocol: 1, dsh, instanceId: this.instanceId }, env.id);
  }

  onPhoneMessage(rawText, mode) {
    const text = typeof rawText === "string" ? rawText.trim() : "";
    if (!text) return;
    if (text.startsWith("/")) {
      this.onCommand(text).catch((err) => this.pushNotice("error", `指令执行失败: ${err.message}`, null, true));
      return;
    }
    this.sendPrompt(text, mode === "steer" ? "steer" : "queue");
  }

  async sendPrompt(text, mode) {
    const sessionId = this.currentSessionId;
    if (!sessionId) {
      this.pushNotice("warn", "当前没有活跃会话，请稍后再试（可用 /sessions 查看）", null, true);
      return;
    }
    this.rememberRecentPhoneMessage(sessionId, text);
    try {
      await this.client.rpc("session.prompt", {
        sessionId,
        mode,
        content: [{ type: "text", text }],
      });
      this.pushNotice("info", `已发送${mode === "steer" ? "（steer 干预）" : ""} → 会话 ${this.sessionLabel(sessionId)}`, null, true);
    } catch (err) {
      this.pushNotice("error", `发送失败: ${err.message}`, null, true);
    }
  }

  onApprovalAnswer(ref, outcome) {
    const p = this.pendingApprovals.get(ref);
    if (!p) {
      this.pushNotice("warn", `审批 ${ref} 已失效（可能已被网页端处理或超时）`, null, true);
      return;
    }
    if (outcome !== "allowed-once" && outcome !== "rejected") {
      this.pushNotice("warn", "无效的审批结果", null, true);
      return;
    }
    this.pendingApprovals.delete(ref);
    this.client
      .respond(p.rpcId, { sessionId: p.sessionId, approvalId: p.approvalId, outcome })
      .then(() => this.pushNotice("info", `已${outcome === "allowed-once" ? "允许" : "拒绝"} 审批 ${ref}`, null, true))
      .catch((err) => {
        if (!/not[- ]?pending|已.*处理|settled/i.test(err.message)) this.pendingApprovals.set(ref, p);
        this.pushNotice("error", `审批应答失败: ${err.message}`, null, true);
      });
  }

  onQuestionAnswer(ref, answers, cancel) {
    const p = this.pendingQuestions.get(ref);
    if (!p) {
      this.pushNotice("warn", `提问 ${ref} 已失效`, null, true);
      return;
    }
    if (cancel) {
      this.pendingQuestions.delete(ref);
      this.client
        .respondError(p.rpcId, { code: "cancelled", message: "the user cancelled ask_user_question" })
        .then(() => this.pushNotice("info", "已取消提问", null, true))
        .catch((err) => {
          if (!/not[- ]?pending|已.*处理|settled/i.test(err.message)) this.pendingQuestions.set(ref, p);
          this.pushNotice("error", `取消提问失败: ${err.message}`, null, true);
        });
      return;
    }
    if (!Array.isArray(answers) || answers.length === 0) {
      this.pushNotice("warn", "无效的回答", null, true);
      return;
    }
    if (answers.length !== p.questions.length || answers.some((answer, index) => answer?.id !== p.questions[index]?.id)) {
      this.pushNotice("warn", "回答数量或题目顺序不匹配", null, true);
      return;
    }
    const invalid = this.validateQuestionAnswers(p.questions, answers);
    if (invalid) {
      this.pushNotice("warn", `回答格式无效: ${invalid}`, null, true);
      return;
    }
    this.pendingQuestions.delete(ref);
    this.client
      .respond(p.rpcId, { sessionId: p.sessionId, answer: { answers } })
      .then(() => this.pushNotice("info", `已回答提问 ${ref}`, null, true))
      .catch((err) => {
        if (!/not[- ]?pending|已.*处理|settled/i.test(err.message)) this.pendingQuestions.set(ref, p);
        this.pushNotice("error", `回答提交失败: ${err.message}`, null, true);
      });
  }

  /* ---------------- 指令 ---------------- */

  async onCommand(text) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = (cmdRaw ?? "").toLowerCase();
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "/help":
        this.pushChat("system", HELP_TEXT);
        break;
      case "/status":
        await this.cmdStatus();
        break;
      case "/sessions":
        await this.cmdSessions();
        break;
      case "/use":
        if (arg) this.cmdUse(arg);
        else this.pushNotice("warn", "用法: /use <会话ID或其后几位>，如 /use a3a4", null, true);
        break;
      case "/history": {
        const n = Number.parseInt(arg, 10);
        await this.cmdHistory(Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 6);
        break;
      }
      case "/new":
        await this.cmdNew(arg);
        break;
      case "/queue":
        this.cmdQueue();
        break;
      case "/drop":
        if (arg) await this.cmdDrop(arg);
        else this.pushNotice("warn", "用法: /drop <排队消息 ID 后缀>", null, true);
        break;
      case "/model":
      case "/models":
        await this.cmdModel();
        break;
      case "/pending":
        this.cmdPending();
        break;
      case "/stop":
        await this.cmdStop();
        break;
      case "/mute":
        this.muted = true;
        this.pushNotice("info", "已静音：只推送审批、提问与错误", null, true);
        this.scheduleHello();
        break;
      case "/unmute":
        this.muted = false;
        this.pushNotice("info", "已取消静音", null, true);
        this.scheduleHello();
        break;
      case "/verbose":
        this.verbose = true;
        this.pushNotice("info", "详细模式：将推送工具调用等事件", null, true);
        this.scheduleHello();
        break;
      case "/quiet":
        this.verbose = false;
        this.pushNotice("info", "简洁模式", null, true);
        this.scheduleHello();
        break;
      case "/steer":
        if (arg) await this.sendPrompt(arg, "steer");
        else this.pushNotice("warn", "用法: /steer <干预文字>", null, true);
        break;
      default:
        this.pushChat("system", `未知命令 ${cmd}，输入 /help 查看帮助`);
        break;
    }
  }

  async cmdStatus() {
    const sid = this.currentSessionId;
    let lines = [];
    try {
      const host = await this.client.rpc("host.describe", {});
      lines.push(`主机: DSH ${host.version ?? "?"} · ${host.cwd ?? "?"}`);
    } catch {
      /* 忽略 */
    }
    if (sid) {
      const info = this.sessions.get(sid) ?? {};
      lines.push(`当前会话: ${shortId(sid)}「${info.title ?? "（未命名）"}」`);
      lines.push(`运行中: ${info.running ? "是" : "否"} · 工作目录: ${info.cwd ?? "?"}`);
      try {
        const models = await this.client.rpc("session.models", { sessionId: sid });
        const cur = models?.current;
        if (cur) lines.push(`模型: ${cur.provider}/${cur.model}`);
      } catch {
        /* 忽略 */
      }
    } else {
      lines.push("当前没有活跃会话");
    }
    this.pushChat("system", lines.join("\n"));
  }

  async cmdSessions() {
    try {
      await this.refreshSessions();
    } catch (err) {
      this.pushNotice("error", `获取会话列表失败: ${err.message}`, null, true);
      return;
    }
    const list = [...this.sessions.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (list.length === 0) {
      this.pushChat("system", "没有会话");
      return;
    }
    const lines = list.map((s) => {
      const mark = s.id === this.currentSessionId ? "👉" : " ";
      return `${mark}[${shortId(s.id)}] ${s.running ? "●" : "○"} ${s.title ?? "（未命名）"}  ${s.blank ? "（空）" : ""}`;
    });
    this.pushChat("system", `会话列表（👉 为当前）:\n${lines.join("\n")}\n切换: /use <ID后几位>`);
  }

  cmdUse(arg) {
    const needle = arg.toLowerCase();
    const matches = [...this.sessions.keys()].filter(
      (id) => id.toLowerCase().endsWith(needle) || id.toLowerCase().startsWith(needle),
    );
    if (matches.length === 1) {
      this.currentSessionId = matches[0];
      this.userChosen = true;
      this.pushNotice("info", `已切换到会话 ${this.sessionLabel(matches[0])}`, null, true);
      this.scheduleHello();
    } else if (matches.length > 1) {
      this.pushNotice("warn", `匹配到 ${matches.length} 个会话，请给更长的 ID 后缀`, null, true);
    } else {
      this.pushNotice("warn", "没有匹配的会话（用 /sessions 查看）", null, true);
    }
  }

  async cmdHistory(n) {
    const sid = this.currentSessionId;
    if (!sid) {
      this.pushNotice("warn", "没有当前会话", null, true);
      return;
    }
    try {
      const res = await this.client.rpc("session.history", { sessionId: sid, maxMessages: n * 2 });
      const events = (res?.events ?? []).map((e) => e?.event).filter(Boolean);
      const messages = events.filter((e) => e.type === "user/message" || e.type === "assistant/message");
      const recent = messages.slice(-n);
      if (recent.length === 0) {
        this.pushChat("system", "暂无对话记录");
        return;
      }
      const lines = recent.map((e) => {
        const role = e.type === "user/message" ? "🙋" : "🤖";
        const text =
          e.type === "user/message" ? blockText(e.data?.content) : blockText(e.data?.message?.content);
        const clean = text.replace(/\s+/g, " ").slice(0, 260);
        return `${role} ${clean}`;
      });
      this.pushChat("system", `最近 ${recent.length} 条对话（会话 ${shortId(sid)}）:\n${lines.join("\n")}`);
    } catch (err) {
      this.pushNotice("error", `获取历史失败: ${err.message}`, null, true);
    }
  }

  async cmdStop() {
    const sid = this.currentSessionId;
    if (!sid) {
      this.pushNotice("warn", "没有当前会话", null, true);
      return;
    }
    try {
      await this.client.rpc("session.cancel", { sessionId: sid });
      this.pushNotice("info", `已请求中断会话 ${this.sessionLabel(sid)}`, null, true);
    } catch (err) {
      this.pushNotice("error", `中断失败: ${err.message}`, null, true);
    }
  }

  async cmdNew(cwd) {
    try {
      let targetCwd = cwd;
      if (!targetCwd) {
        const host = await this.client.rpc("host.describe", {});
        targetCwd = host?.cwd;
      }
      if (!targetCwd) throw new Error("无法确定新会话工作目录，请使用 /new <目录>");
      const payload = { cwd: targetCwd };
      const created = await this.client.rpc("session.create", payload);
      if (!created?.sessionId) throw new Error("DSH 未返回 sessionId");
      this.rememberSession(created.sessionId);
      this.currentSessionId = created.sessionId;
      this.userChosen = true;
      await this.refreshSessions().catch(() => {});
      this.pushNotice("info", `已新建并切换到会话 ${this.sessionLabel(created.sessionId)}`, null, true);
      this.scheduleHello();
    } catch (err) {
      this.pushNotice("error", `新建会话失败: ${err.message}`, null, true);
    }
  }

  cmdQueue() {
    const sid = this.currentSessionId;
    if (!sid) return this.pushNotice("warn", "没有当前会话", null, true);
    const items = this.lastQueues.get(sid) ?? [];
    if (items.length === 0) return this.pushChat("system", "当前没有排队消息");
    const lines = items.map((item) => {
      const text = blockText(item.message?.content ?? item.message).replace(/\s+/g, " ").slice(0, 180);
      return `[${shortId(item.id)}] ${item.placement ?? "queued"} ${text}`;
    });
    this.pushChat("system", `当前队列：\n${lines.join("\n")}\n删除: /drop <ID后缀>`);
  }

  async cmdDrop(needle) {
    const sid = this.currentSessionId;
    if (!sid) return this.pushNotice("warn", "没有当前会话", null, true);
    const items = this.lastQueues.get(sid) ?? [];
    const matches = items.filter((item) => String(item.id).toLowerCase().endsWith(needle.toLowerCase()));
    if (matches.length !== 1) {
      this.pushNotice("warn", matches.length > 1 ? "匹配到多条消息，请提供更长 ID" : "没有匹配的排队消息", null, true);
      return;
    }
    try {
      await this.client.rpc("session.updateQueue", {
        sessionId: sid,
        itemId: matches[0].id,
        action: { kind: "remove" },
      });
      this.pushNotice("info", `已删除排队消息 ${shortId(matches[0].id)}`, sid, true);
    } catch (err) {
      this.pushNotice("error", `删除排队消息失败: ${err.message}`, sid, true);
    }
  }

  async cmdModel() {
    const sid = this.currentSessionId;
    if (!sid) return this.pushNotice("warn", "没有当前会话", null, true);
    try {
      const models = await this.client.rpc("session.models", { sessionId: sid });
      const current = models?.current;
      this.pushChat("system", current ? `当前模型: ${current.provider}/${current.model}` : "DSH 未返回当前模型");
    } catch (err) {
      this.pushNotice("error", `获取模型失败: ${err.message}`, sid, true);
    }
  }

  cmdPending() {
    const approvals = [...this.pendingApprovals.entries()].map(([ref, value]) =>
      `⚠ ${ref} ${this.sessionLabel(value.sessionId)} ${value.toolName ?? "?"}`);
    const questions = [...this.pendingQuestions.entries()].map(([ref, value]) =>
      `❓ ${ref} ${this.sessionLabel(value.sessionId)} ${value.questions.length} 个问题`);
    const lines = [...approvals, ...questions];
    this.pushChat("system", lines.length > 0 ? `待处理：\n${lines.join("\n")}` : "没有待处理的审批或提问");
  }

  /* ---------------- 会话簿记 ---------------- */

  async refreshSessions() {
    const res = await this.client.rpc("session.list", {});
    const next = new Map();
    for (const item of res?.items ?? []) {
      next.set(item.sessionId, {
        id: item.sessionId,
        title: item.projections?.values?.title,
        running: item.running === true,
        updatedAt: item.updatedAt,
        cwd: item.cwd,
        blank: item.blank === true,
      });
    }
    this.sessions = next;
    this.preferRunningSession();
  }

  /** 默认当前会话：尊重手机显式选择；否则优先「正在运行」的会话，其次最近更新。 */
  preferRunningSession() {
    const values = [...this.sessions.values()];
    if (values.length === 0) return;
    const current = this.currentSessionId ? this.sessions.get(this.currentSessionId) : undefined;
    if (this.userChosen) {
      if (current) return; // 手机端显式选择过的会话保持不动
      this.userChosen = false; // 所选会话已消失，回退自动偏好
    }
    if (current?.running) return; // 已指向运行中的会话
    const byTime = values.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    const running = byTime.find((s) => s.running === true);
    const pick = running ?? byTime[0];
    if (!current || pick.running === true) this.currentSessionId = pick.id;
  }

  rememberSession(id) {
    if (id && !this.sessions.has(id)) this.sessions.set(id, { id, title: undefined, running: true, updatedAt: Date.now() });
  }

  sessionLabel(id) {
    const s = this.sessions.get(id);
    return `[${shortId(id)}]${s?.title ? `「${s.title.slice(0, 20)}」` : ""}`;
  }

  isRecentPhoneMessage(sessionId, text) {
    const now = Date.now();
    return this.recentPhoneMessages.some(
      (m) => m.sessionId === sessionId && m.text === text && now - m.ts < 60_000,
    );
  }

  rememberRecentPhoneMessage(sessionId, text) {
    this.recentPhoneMessages.push({ sessionId, text, ts: Date.now() });
    if (this.recentPhoneMessages.length > 10) this.recentPhoneMessages.shift();
  }

  validateQuestionAnswers(questions, answers) {
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index];
      const answer = answers[index];
      if (!Array.isArray(answer.selected) || answer.selected.some((value) => typeof value !== "string")) {
        return `第 ${index + 1} 题 selected 必须是字符串数组`;
      }
      const labels = new Set((question.options ?? []).map((option) => option.label));
      if (answer.selected.some((value) => !labels.has(value))) return `第 ${index + 1} 题包含未知选项`;
      if (!question.multiSelect && answer.selected.length > 1) return `第 ${index + 1} 题只能选择一个选项`;
      if (typeof answer.custom === "string" && answer.custom.trim().length === 0) return `第 ${index + 1} 题自定义回答不能为空`;
      if (!question.multiSelect && typeof answer.custom === "string" && answer.selected.length > 0) {
        return `第 ${index + 1} 题不能同时选择选项并填写自定义回答`;
      }
    }
    return null;
  }

  scheduleHello() {
    if (this.helloTimer) return;
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null;
      this.sendHello().catch((err) => this.logger.warn(`会话状态同步失败: ${err.message}`));
    }, 400);
  }

  async sendHello() {
    try {
      await this.refreshSessions();
    } catch {
      /* 忽略 */
    }
    let host = {};
    try {
      host = await this.client.rpc("host.describe", {});
    } catch {
      /* 忽略 */
    }
    const list = [...this.sessions.values()]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .map((s) => ({
        id: s.id,
        short: shortId(s.id),
        title: s.title ?? "（未命名）",
        running: s.running === true,
        blank: s.blank === true,
        current: s.id === this.currentSessionId,
      }));
    this.push("hello", {
      host: { version: host.version ?? "?", cwd: host.cwd ?? "?" },
      sessions: list,
      muted: this.muted,
      verbose: this.verbose,
      pendingApprovals: [...this.pendingApprovals.entries()].map(([ref, value]) => ({
        ref,
        sessionId: value.sessionId,
        sessionLabel: this.sessionLabel(value.sessionId),
        toolName: value.toolName,
        reason: value.reason,
      })),
      pendingQuestions: [...this.pendingQuestions.entries()].map(([ref, value]) => ({
        ref,
        sessionId: value.sessionId,
        sessionLabel: this.sessionLabel(value.sessionId),
        questions: value.questions,
      })),
    }, undefined, true);
  }

  /* ---------------- 推送 ---------------- */

  push(kind, data, ref, force = false) {
    if (this.muted && !force) return;
    try {
      this.relay?.publish(kind, data, ref);
    } catch (err) {
      this.logger.error(`[桥接] 推送入可靠队列失败: ${err.message}`);
    }
  }

  pushChat(role, text, sessionId) {
    const label = sessionId ? this.sessionLabel(sessionId) : null;
    const head = sessionId && sessionId !== this.currentSessionId ? `${label}\n` : "";
    if (text.length <= PUSH_CHUNK) {
      this.push("chat", { role, sessionId, text: head + text });
      return;
    }
    const parts = [];
    let rest = head + text;
    let i = 0;
    while (rest.length > 0) {
      i += 1;
      parts.push(rest.slice(0, PUSH_CHUNK));
      rest = rest.slice(PUSH_CHUNK);
    }
    parts.forEach((part, idx) =>
      this.push("chat", { role, sessionId, text: part, part: idx + 1, totalParts: parts.length }),
    );
  }

  pushNotice(level, text, sessionId, force = false) {
    this.push(
      "notice",
      { level: level === "error" || level === "warn" ? level : "info", text, sessionId },
      null,
      force,
    );
  }

  prunePendings() {
    const now = Date.now();
    for (const [ref, p] of this.pendingApprovals) {
      if (now - p.ts > PENDING_TTL_MS) this.pendingApprovals.delete(ref);
    }
    for (const [ref, p] of this.pendingQuestions) {
      if (now - p.ts > PENDING_TTL_MS) this.pendingQuestions.delete(ref);
    }
  }
}
