import { createRemoteJWKSet, jwtVerify, RemoteJWKSet } from "jose"

export class AuthorizationServices {
    private readonly remoteJWKSet: RemoteJWKSet | null
    private readonly issuer: string | null
    private readonly audience: string | null

    constructor(accessTeamDomain?: string, accessAudience?: string) {
        accessTeamDomain = accessTeamDomain?.replace(/\/$/, '')
        if (process.env.NODE_ENV === 'production' && (!accessTeamDomain || !accessAudience)) {
            throw new Error('CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required in production.')
        }

        this.remoteJWKSet = accessTeamDomain && accessAudience
            ? createRemoteJWKSet(new URL(`${accessTeamDomain}/cdn-cgi/access/certs`))
            : null
        this.issuer = accessTeamDomain || null
        this.audience = accessAudience || null
    }

    get enabled(): boolean {
        return this.remoteJWKSet !== null
    }

    async validateToken(token: string): Promise<void> {
        if (!this.remoteJWKSet || !this.issuer || !this.audience) return
        await jwtVerify(token, this.remoteJWKSet, { issuer: this.issuer, audience: this.audience })
    }
}
