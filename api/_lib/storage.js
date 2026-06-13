import { Redis } from "@upstash/redis";

const memoryStore = globalThis.__HUB_CHESS_MEMORY_STORE__ || new Map();
globalThis.__HUB_CHESS_MEMORY_STORE__ = memoryStore;

let redisClient = null;

function resolveRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  if (!url || !token) return null;
  return { url, token };
}

function getRedis() {
  if (redisClient) return redisClient;
  const config = resolveRedisConfig();
  if (!config) return null;
  redisClient = new Redis(config);
  return redisClient;
}

function roomKey(roomId) {
  return `7ub-chess:room:${roomId}`;
}

export async function getRoom(roomId) {
  const key = roomKey(roomId);
  const redis = getRedis();
  if (redis) return redis.get(key);
  return memoryStore.get(key) || null;
}

export async function setRoom(roomId, room, ttlSeconds = 86400) {
  const key = roomKey(roomId);
  const redis = getRedis();
  if (redis) {
    await redis.set(key, room, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, room);
}

export async function deleteRoom(roomId) {
  const key = roomKey(roomId);
  const redis = getRedis();
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryStore.delete(key);
}

export function usingPersistentStorage() {
  return Boolean(resolveRedisConfig());
}
