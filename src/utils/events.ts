import { RequestHandler, Response } from "express";

const clients = new Set<Response>();
let nextClientId = 0;

export const eventsHandler: RequestHandler = (_req, res) => {
    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });

    res.flushHeaders();
    res.write("event: connected\ndata: {}\n\n");
    clients.add(res);
    const clientId = ++nextClientId;
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), event: "sse_connected", clientId, clients: clients.size }));

    const heartbeat = setInterval(() => {
        res.write("event: heartbeat\ndata: {}\n\n");
        console.info(JSON.stringify({ timestamp: new Date().toISOString(), event: "sse_heartbeat_written", clientId }));
    }, 20_000);
    res.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
        console.info(JSON.stringify({ timestamp: new Date().toISOString(), event: "sse_closed", clientId, clients: clients.size }));
    });
};

export function notify(type: string, id: number | string): void {
    const data =
        `event: matches\ndata: ${JSON.stringify({ type, id })}\n\n`;

    for (const client of clients) {
        client.write(data);
    }
}
