import { randomBytes } from "crypto";
import { Service } from "./../ServiceNetwork"
import { strict as assert } from 'assert';

import koa = require("koa");

function generate_id(): string {
	return randomBytes(10).toString("hex");
}

export interface SessionState {
	session: Map<string, any>;
}

export interface SessionStore {
	/**
	 * Should return the map of settings associated with the key
	 * @param key the key of the session
	 * @return the map of settings or null if the key is invalid or expired
	 */
	get(key: string): Promise<Map<string, string> | null>;
	/**
	 * Set the map of settings associated to the key, if the key is invalid, then do nothing and return
	 * @param key the key of the session
	 * @param data the map of settings
	 */
	set(key: string, data: Map<string, string>): Promise<void>;
	/**
	 * Create a session
	 * @param key the key for the new session
	 * @param data the data for the new session
	 * @param expires when the session should expire
	 */
	create(key: string, data: Map<string, string>, expires: Date): Promise<void>;
};

export interface SessionConfig {
	/**
	 * The cookie key that should store the session key
	 */
	key: string;
	/**
	 * The amount of time that the session key should be valid for in milliseconds
	 */
	expires: number;
}

interface StoreData {
	expires: Date;
	data: Map<string, string>;
}

/**
 * This store saves data to memory and it will not be persistent, this should only be used for development
 */
export class MemoryStore {
	private data: Map<string, StoreData>
	constructor() {
		this.data = new Map();
	}

	async get(key: string): Promise<Map<string, string> | null> {
		let data = this.data.get(key);
		if (data == null) {
			return null;
		}
		if (data.expires.getTime() < (new Date()).getTime()) {
			this.data.delete(key);
			return null;
		}
		return data.data;
	}
	
	async set(key: string, data: Map<string, string>): Promise<void> {
		let d = this.data.get(key);
		if (d == null) {
			return;
		}
		d.data = data;
	}

	async create(key: string, data: Map<string, string>, expires: Date): Promise<void> {
		this.data.set(key, {
			data: data,
			expires: expires
		});
	}
}

/**
 * Session service that can be used with an arbitary session store
 */
export class SessionService implements Service {
	private store: SessionStore;
	private config: SessionConfig;
	private data_id: string | null;

	/**
	 * Creates session middleware for use with koa
	 * @param store A class that implements StoreData
	 */
	constructor(config: SessionConfig, store: SessionStore) {
		this.config = config;
		this.store = store;
	}

	/**
	 * Get the session for a request
	 * @param ctx the context from koa
	 * @returns the session values, changes in here will be saved when the request ends, if an error occurs it is caught and rethrown after the session has saved
	 * @throws {Error} if the session middleware has not been added correctly
	 */
	async get_session(ctx: koa.Context): Promise<Map<string, string>> {
		if (this.data_id == null) {
			throw new Error("Internal error, this.data_id was not set");	
		}
		
		if (ctx.state[this.data_id] != null) {
			assert(typeof(ctx.state[this.data_id]) == "object");
			assert(ctx.state[this.data_id].data instanceof Map);
			assert(typeof(ctx.state[this.data_id].key) == "string");
			return ctx.state[this.data_id].data;
		}

		//TODO: need to get cookie with right options
		let id = ctx.cookies.get(this.config.key);
		let session_data: Map<string, string> | null = null;
		if (id != null) {
			session_data = await this.store.get(id);
		} else {
			id = generate_id();
		}
		//TODO: need to set cookie with right options
		ctx.cookies.set(this.config.key, id);

		if (session_data == null) {
			ctx.state[this.data_id] = {key: id, data: new Map(), create: true};
			return ctx.state[this.data_id].data;
		} else {
			ctx.state[this.data_id] = {key: id, data: session_data, create: false};
		}
		return ctx.state[this.data_id].data;
	}

	create_middleware(data_id: string): Array<koa.Middleware> {
		this.data_id = data_id;
		return [async (ctx: koa.Context, next: koa.Next) => {
			if (this.data_id == null) {
				throw new Error("Internal error, this.data_id was not set");	
			}
			try {
				await next();
			} catch (e) {
				await this.save_state(ctx);
				throw e;
			}
			
			await this.save_state(ctx);
		}];
	}
	
	private async save_state(ctx: koa.Context) {
		if (this.data_id == null) {
			throw new Error("Internal error, this.data_id was not set");	
		}
		if (ctx.state[this.data_id] == null) {
			return;
		}
		assert(typeof(ctx.state[this.data_id]) == "object");
		assert(ctx.state[this.data_id].data instanceof Map);
		assert(typeof(ctx.state[this.data_id].key) == "string");
		if (ctx.state[this.data_id].create === true) {
			await this.store.create(ctx.state[this.data_id].key, ctx.state[this.data_id].data, new Date((new Date()).getTime() + this.config.expires));
		} else {
			await this.store.set(ctx.state[this.data_id].key, ctx.state[this.data_id].data);
		}
	}
}

/**
 * Creates session middleware for use with koa 
 * use Application.ParameterizedContext<SessionState> for types
 * @param store A class that implements StoreData
 */
export function session(config: SessionConfig, store: SessionStore) {
	return async (ctx: koa.ParameterizedContext<SessionState>, next: koa.Next) => {
		//TODO: need to get cookie with right options
		let id = ctx.cookies.get(config.key);
		let session_data: Map<string, string> | null = null;
		if (id != null) {
			session_data = await store.get(id);
		} else {
			id = generate_id();
		}
		//TODO: need to set cookie with right options
		ctx.cookies.set(config.key, id);
		if (session_data == null) {
			ctx.state.session = new Map();
			await next();
			await store.create(id, ctx.state.session, new Date((new Date()).getTime() + config.expires));
		} else {
			ctx.state.session = session_data;
			await next();
			await store.set(id, ctx.state.session);
		}

		await next();
	}
}
