import { createPullHandler } from "../lib/handlers.js";
import { redisStore } from "../lib/redis-store.js";

export default { fetch: createPullHandler({ store: redisStore }) };
