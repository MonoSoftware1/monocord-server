import {
	ConnectedAccount,
	ConnectedAccountCommonOAuthTokenResponse,
	ConnectionCallbackSchema,
	ConnectionLoader,
	DiscordApiErrors,
} from "@fosscord/util";
import wretch from "wretch";
import Connection from "../../util/connections/Connection";
import { XboxSettings } from "./XboxSettings";

interface XboxUserResponse {
	IssueInstant: string;
	NotAfter: string;
	Token: string;
	DisplayClaims: {
		xui: {
			gtg: string;
			xid: string;
			uhs: string;
			agg: string;
			usr: string;
			utr: string;
			prv: string;
		}[];
	};
}

interface XboxErrorResponse {
	error: string;
	error_description: string;
}

export default class XboxConnection extends Connection {
	public readonly id = "xbox";
	public readonly authorizeUrl =
		"https://login.live.com/oauth20_authorize.srf";
	public readonly tokenUrl = "https://login.live.com/oauth20_token.srf";
	public readonly userInfoUrl =
		"https://xsts.auth.xboxlive.com/xsts/authorize";
	public readonly userAuthUrl =
		"https://user.auth.xboxlive.com/user/authenticate";
	public readonly scopes = ["Xboxlive.signin", "Xboxlive.offline_access"];
	settings: XboxSettings = new XboxSettings();

	init(): void {
		this.settings = ConnectionLoader.getConnectionConfig(
			this.id,
			this.settings,
		) as XboxSettings;
	}

	getAuthorizationUrl(userId: string): string {
		const state = this.createState(userId);
		const url = new URL(this.authorizeUrl);

		url.searchParams.append("client_id", this.settings.clientId!);
		url.searchParams.append("redirect_uri", this.getRedirectUri());
		url.searchParams.append("response_type", "code");
		url.searchParams.append("scope", this.scopes.join(" "));
		url.searchParams.append("state", state);
		url.searchParams.append("approval_prompt", "auto");
		return url.toString();
	}

	getTokenUrl(): string {
		return this.tokenUrl;
	}

	async getUserToken(token: string): Promise<string> {
		return wretch(this.userAuthUrl)
			.headers({
				"x-xbl-contract-version": "3",
				"Content-Type": "application/json",
				Accept: "application/json",
			})
			.body(
				JSON.stringify({
					RelyingParty: "http://auth.xboxlive.com",
					TokenType: "JWT",
					Properties: {
						AuthMethod: "RPS",
						SiteName: "user.auth.xboxlive.com",
						RpsTicket: `d=${token}`,
					},
				}),
			)
			.post()
			.json((res: XboxUserResponse) => res.Token)
			.catch((e) => {
				console.error(e);
				throw DiscordApiErrors.GENERAL_ERROR;
			});
	}

	async exchangeCode(
		state: string,
		code: string,
	): Promise<ConnectedAccountCommonOAuthTokenResponse> {
		this.validateState(state);

		const url = this.getTokenUrl();

		return wretch(url.toString())
			.headers({
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${Buffer.from(
					`${this.settings.clientId!}:${this.settings.clientSecret!}`,
				).toString("base64")}`,
			})
			.body(
				new URLSearchParams({
					grant_type: "authorization_code",
					code: code,
					client_id: this.settings.clientId!,
					redirect_uri: this.getRedirectUri(),
					scope: this.scopes.join(" "),
				}),
			)
			.post()
			.json<ConnectedAccountCommonOAuthTokenResponse>()
			.catch((e) => {
				console.error(e);
				throw DiscordApiErrors.GENERAL_ERROR;
			});
	}

	async getUser(token: string): Promise<XboxUserResponse> {
		const url = new URL(this.userInfoUrl);

		return wretch(url.toString())
			.headers({
				"x-xbl-contract-version": "3",
				"Content-Type": "application/json",
				Accept: "application/json",
			})
			.body(
				JSON.stringify({
					RelyingParty: "http://xboxlive.com",
					TokenType: "JWT",
					Properties: {
						UserTokens: [token],
						SandboxId: "RETAIL",
					},
				}),
			)
			.post()
			.json<XboxUserResponse>()
			.catch((e) => {
				console.error(e);
				throw DiscordApiErrors.GENERAL_ERROR;
			});
	}

	async handleCallback(
		params: ConnectionCallbackSchema,
	): Promise<ConnectedAccount | null> {
		const userId = this.getUserId(params.state);
		const tokenData = await this.exchangeCode(params.state, params.code!);
		const userToken = await this.getUserToken(tokenData.access_token);
		const userInfo = await this.getUser(userToken);

		const exists = await this.hasConnection(
			userId,
			userInfo.DisplayClaims.xui[0].xid,
		);

		if (exists) return null;

		return await this.createConnection({
			token_data: { ...tokenData, fetched_at: Date.now() },
			user_id: userId,
			external_id: userInfo.DisplayClaims.xui[0].xid,
			friend_sync: params.friend_sync,
			name: userInfo.DisplayClaims.xui[0].gtg,
			type: this.id,
		});
	}
}
