import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BettingSessionRecord,
  DailyRecord,
  DeviceIdentityRecord,
  GameResultRecord,
  PlayerRecord,
} from "./types";

const DB_NAME = "boardgame-db";
const DB_VERSION = 1;

interface BoardGameDB extends DBSchema {
  players: {
    key: string;
    value: PlayerRecord;
    indexes: { "by-name": string };
  };
  identities: {
    key: string; // deviceId
    value: DeviceIdentityRecord;
    indexes: { "by-player": string };
  };
  bettingSessions: {
    key: string;
    value: BettingSessionRecord;
    indexes: { "by-status": string };
  };
  dailyRecords: {
    key: string;
    value: DailyRecord;
    indexes: { "by-date": string };
  };
  gameResults: {
    key: string;
    value: GameResultRecord;
    indexes: { "by-game": string };
  };
}

let dbPromise: Promise<IDBPDatabase<BoardGameDB>> | null = null;

/**
 * IndexedDB is only available in the browser. Every caller of this module
 * must be client-side code ("use client" components, hooks, or code only
 * invoked from within them) — calling it during SSR/build throws.
 */
export function getDb(): Promise<IDBPDatabase<BoardGameDB>> {
  if (typeof window === "undefined") {
    throw new Error("getDb() can only be called in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB<BoardGameDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const players = db.createObjectStore("players", { keyPath: "id" });
        players.createIndex("by-name", "name");

        const identities = db.createObjectStore("identities", {
          keyPath: "deviceId",
        });
        identities.createIndex("by-player", "playerId");

        const sessions = db.createObjectStore("bettingSessions", {
          keyPath: "id",
        });
        sessions.createIndex("by-status", "status");

        const daily = db.createObjectStore("dailyRecords", { keyPath: "id" });
        daily.createIndex("by-date", "date");

        const results = db.createObjectStore("gameResults", { keyPath: "id" });
        results.createIndex("by-game", "gameId");
      },
    });
  }
  return dbPromise;
}

export type { BoardGameDB };
