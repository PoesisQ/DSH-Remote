import { createPushHandler } from "../lib/handlers.js";
import { redisStore } from "../lib/redis-store.js";

export default { fetch: createPushHandler({ store: redisStore }) };
