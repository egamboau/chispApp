import express, { Application, ErrorRequestHandler, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import path from "path";
import DBConnection from "./db/db_connection";
import { TournamentRepository } from "./repository/tournament_repository";
import { TournamentService } from "./service/tournament_service";
import { TournamentController } from "./controller/tournament_controller";
import { TournamentRoute } from "./routes/tournaments";
import { RootRoute } from "./routes/root";
import { PhaseService } from "./service/phase_service";
import { PhaseRepository } from "./repository/phase_repository";
import { PhaseController } from "./controller/phase_controller";
import { PhaseRoute } from "./routes/phases";
import { GroupRepository } from "./repository/group_repository";
import { GroupService } from "./service/group_service";
import { GroupController } from "./controller/group_controller";
import { GroupRoute } from "./routes/groups";
import { TeamRepository } from "./repository/team_repository";
import { TeamService } from "./service/team_service";
import { TeamController } from "./controller/team_controller";
import { TeamRoute } from "./routes/teams";
import { PlayerRepository } from "./repository/player_repository";
import { PlayerService } from "./service/player_service";
import { PlayerController } from "./controller/player_controller";
import { PlayerRoute } from "./routes/players";
import { PhaseDetailRepository } from "./repository/phase_detail_repository";
import { PhaseDetailService } from "./service/phase_detail_service";
import { PhaseDetailController } from "./controller/phase_detail_controller";
import { PhaseDetailRoute } from "./routes/phase_details";
import { MatchRepository } from "./repository/match_repository";
import { MatchService } from "./service/match_service";
import { MatchController } from "./controller/match_controller";
import { MatchRoute } from "./routes/matches";
import { AuthorizationServices } from "./utils/security";

class App {

    private readonly app:Application

    private readonly port:number

    private dbConnection:DBConnection

    private readonly authorizationServices: AuthorizationServices

    constructor() {
        this.app = express();
        this.port = Number(process.env.PORT) || 3000;
        this.authorizationServices = new AuthorizationServices(process.env.CF_ACCESS_TEAM_DOMAIN, process.env.CF_ACCESS_AUD)
        this.dbConnection = new DBConnection(process.env.DATABASE_PATH || path.join(__dirname, 'data', 'tournament.db'))
        this.init()
    }

    private init() {
        this.initMiddleware()
        this.initRoutes()
    }

    private initRoutes() {

        const rootRoute = new RootRoute()
        this.app.use(rootRoute.router)

        const phaseRepository = new PhaseRepository(this.dbConnection)
        const phaseService = new PhaseService(phaseRepository)

        const tournamentRepository = new TournamentRepository(this.dbConnection)
        const tournamentService = new TournamentService(tournamentRepository)
        const tournamentController = new TournamentController(tournamentService, phaseService)
        const tournamentRoute = new TournamentRoute(tournamentController)
        this.app.use(tournamentRoute.router)

        const phaseController = new PhaseController(phaseService, tournamentService)
        const phaseRoute = new PhaseRoute(phaseController)
        this.app.use(phaseRoute.router)

        const groupRepository = new GroupRepository(this.dbConnection)
        const groupService = new GroupService(groupRepository)
        const groupController = new GroupController(groupService, phaseService)
        const groupRoute = new GroupRoute(groupController)
        this.app.use(groupRoute.router)

        const teamService = new TeamService(new TeamRepository(this.dbConnection))
        const teamController = new TeamController(teamService, tournamentService)
        this.app.use(new TeamRoute(teamController).router)

        const playerService = new PlayerService(new PlayerRepository(this.dbConnection))
        this.app.use(new PlayerRoute(new PlayerController(playerService, teamService)).router)

        const phaseDetailService = new PhaseDetailService(new PhaseDetailRepository(this.dbConnection), phaseService)
        const phaseDetailController = new PhaseDetailController(phaseDetailService, phaseService, groupService, teamService)
        this.app.use(new PhaseDetailRoute(phaseDetailController).router)

        const matchService = new MatchService(new MatchRepository(this.dbConnection), phaseService, groupService, teamService, tournamentService)
        this.app.use(new MatchRoute(new MatchController(matchService)).router)

        this.app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }))
        const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(), level: 'error', event: 'request_error',
                method: req.method, path: req.originalUrl,
                error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) },
            }))
            res.status(500).json({ error: 'Error interno del servidor.' })
        }
        this.app.use(errorHandler)

    }

    private initMiddleware() {
        this.app.use((req, res, next) => {
            if (!req.path.startsWith('/api')){
                return next()
            };
            const startedAt = Date.now();
            const requestId = randomUUID();
            res.set('X-Request-Id', requestId);
            res.on(
                'finish',
                () => {
                    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
                    console[level](
                        JSON.stringify({
                                timestamp: new Date().toISOString(),
                                level: level,
                                event: 'request',
                                requestId,
                                method: req.method,
                                path: req.originalUrl,
                                status: res.statusCode,
                                durationMs: Date.now() - startedAt
                        }
                    ));
                }
            );
            next();
        });
        this.app.use(express.json({ limit: '20kb' }));
        const publicApiPaths = [/^\/api\/tournaments$/, /^\/api\/tournaments\/\d+\/phases$/, /^\/api\/matches$/, /^\/api\/phases\/\d+\/standings$/, /^\/api\/events$/]
        this.app.use(async (req, res, next) => {
            const adminPage = req.path === '/admin' || req.path.startsWith('/admin/')
            const adminApi = req.path === '/api/admin' || req.path.startsWith('/api/admin/')
            if (adminPage || adminApi) {
                if (!await this.requireAccess(req, res)) return
                if (adminApi) {
                    (req as Request & { isAdmin?: boolean }).isAdmin = true
                    req.url = req.url.replace(/^\/api\/admin(?=\/|$)/, '/api')
                }
                return next()
            }
            if (req.path.startsWith('/api/') && (!['GET', 'HEAD'].includes(req.method) || !publicApiPaths.some(pattern => pattern.test(req.path)))) {
                return res.status(404).json({ error: 'Ruta no encontrada.' })
            }
            next()
        })
        this.app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

    }

    private async requireAccess(req: Request, res: Response): Promise<boolean> {
        if (!this.authorizationServices.enabled) return true
        const token = req.get('Cf-Access-Jwt-Assertion')
        if (!token) {
            res.status(403).json({ error: 'Acceso administrativo requerido.' })
            return false
        }
        try {
            await this.authorizationServices.validateToken(token)
            return true
        } catch (error) {
            const code = error instanceof Error && 'code' in error ? String(error.code) : ''
            const unavailable = error instanceof TypeError || ['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC'].includes(code)
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(), level: 'error', event: 'access_validation_failed',
                error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) },
            }))
            res.status(unavailable ? 503 : 403).json({ error: unavailable ? 'No se pudo validar el acceso.' : 'Acceso administrativo inválido.' })
            return false
        }
    }


    listen() {
        this.app.listen(
            this.port,
            '0.0.0.0',
            () => console.log(
                JSON.stringify({ timestamp: new Date().toISOString(),
                    level: 'info',
                    event: 'server_started',
                    address: `0.0.0.0:${this.port}`})));
    }
}

export default App
