import { Router } from "express";
import { eventsHandler } from "../utils/events";

export class RootRoute {
    readonly router: Router;

    constructor() {
        this.router = Router();
        this.initRoutes()
    }


    private initRoutes() {
        this.router.get('/', (_req, res) => res.redirect('/display'))
        this.router.head('/api/events', (_req, res) => res.status(200).end())
        this.router.get('/api/events', eventsHandler)
    }


}
