import { createAppGateway } from "../lib/app-gateway.js";
import { createRedisStore } from "../lib/redis-store.js";

export default { fetch: createAppGateway({ storeFactory: createRedisStore }) };
