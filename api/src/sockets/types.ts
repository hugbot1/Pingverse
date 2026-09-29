import type { Server, Socket } from 'socket.io';

export interface SocketData {
  voiceRoom?: { key: string; conversation: string } | null;
  typingConversation?: string | null;
  typingTimeout?: NodeJS.Timeout;
}

type NoEvents = Record<string, (...args: any[]) => void>;

export type AppServer = Server<NoEvents, NoEvents, NoEvents, SocketData>;
export type AppSocket = Socket<NoEvents, NoEvents, NoEvents, SocketData>;

export type Ack = (result: Record<string, unknown>) => void;