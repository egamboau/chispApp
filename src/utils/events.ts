import { RequestHandler, Response } from "express";

const clients = new Set<Response>();

export const eventsHandler: RequestHandler = (req, res) => {
    res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
    });

    res.flushHeaders();
    res.write("event: connected\ndata: {}\n\n");
    clients.add(res);

    req.on("close", () => clients.delete(res));
};

export function notify(type: string, id: number | string): void {
    const data =
        `event: matches\ndata: ${JSON.stringify({ type, id })}\n\n`;

    for (const client of clients) {
        client.write(data);
    }
}