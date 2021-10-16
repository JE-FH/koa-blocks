import koa = require("koa");
import { Service, ServiceNetwork } from "../ServiceNetwork";
import { SessionService } from "./SessionService";
import {randomBytes, pbkdf2, timingSafeEqual} from "crypto";

export interface AuthenticatableUserData {
	authentication_string?: string;
	id: number;
}

export interface UserStorage<T> {
	get_by_id(id: number): Promise<T | null>;
}

interface RequestNotLoggedInData {
	is_authenticated: false;
}

interface RequestLoggedInData<UserData> {
	is_authenticated: true;
	user: UserData;
}

type RequestUserData<UserData> = RequestLoggedInData<UserData> | RequestNotLoggedInData;

function parse_int_safe(string_number: string | undefined): number {
	let parsed = Number(string_number);
	if (!Number.isInteger(parsed)) {
		return Number.NaN;
	}
	return parsed;
}

export enum Algorithm {
	PBKDF2
}

interface AuthenticationObject {
	algorithm: Algorithm;
	encoding: BufferEncoding;
	hash_function: string;
	hash_length: number;
	rounds: number;
	salt: Buffer;
	hash: Buffer;
}

async function safe_verify_authentication_string(authentication_string: string, password: string, encodings: BufferEncoding[]): Promise<boolean> {
	let parsed = parse_authentication_string(authentication_string, encodings);
	if (parsed.algorithm == Algorithm.PBKDF2) {
		let other_key = await (new Promise<Buffer>((resolve,reject) => {
			pbkdf2(password, parsed.salt, parsed.rounds, parsed.hash_length, parsed.hash_function, (err, key) => {
				if (err) {
					reject(err);
				} else {
					resolve(key);
				}
			});
		}));

		if (timingSafeEqual(parsed.hash, other_key)) {
			return true;
		} else {
			return false;
		}
	} else {
		throw new InvalidAuthenticationString("Unsupported algorithm");
	}
}

/**
 * Parses an authentication string
 * @param authentication_string the raw authentication string
 * @throws {InvalidAuthenticationString} if the authentication isnt valid
 */
function parse_authentication_string(authentication_string: string, encodings: BufferEncoding[]): AuthenticationObject {
	let match = (/^([^$]+)\$([^$]+)\$([^$]+)\$([^$]+)\$([^$]+)\$([^$]+)\$([^$]+)$/g).exec(authentication_string);

	let rv: Partial<AuthenticationObject> = {};

	if (match == null) {
		throw new InvalidAuthenticationString("invalid format");
	}

	if (Number(match[1]) === Algorithm.PBKDF2) {
		rv.algorithm = Algorithm.PBKDF2;
	} else {
		throw new InvalidAuthenticationString("invalid algorithm");
	}

	let match_2 = match[2];

	/*
	Here i have to cast to any because the type definition only allows to search for items we know are included in the array
	This makes no sense in this context since this is exactly what includes is supposed to check. Obviously it would be wrong
	to check if a number was included, but string and the string union has a overlap so this makes no sense.
	*/
	if (encodings.includes(match_2 as any)) {
		rv.encoding = match_2 as BufferEncoding;
	} else {
		throw new InvalidAuthenticationString("invalid encoding");
	}

	rv.rounds = Number(match[3]);
	if (!Number.isInteger(rv.rounds) || rv.rounds < 1) {
		throw new InvalidAuthenticationString("invalid amount of rounds");
	}

	rv.hash_function = match[4];

	if (typeof rv.hash_function != "string") {
		throw new InvalidAuthenticationString("invalid hash function");
	}

	rv.hash_length = Number(match[5]);

	if (!Number.isInteger(rv.hash_length) || rv.hash_length < 1) {
		throw new InvalidAuthenticationString("invalid hash length");
	}

	try {
		rv.salt = Buffer.from(match[6], rv.encoding);
	} catch (e) {
		throw new InvalidAuthenticationString("salt could not be converted to buffer");
	}

	try {
		rv.hash =  Buffer.from(match[7], rv.encoding);
	} catch (e) {
		throw new InvalidAuthenticationString("hash could not be converted to buffer");
	}

	//TODO: Maybe there is a better way to do this
	return rv as unknown as AuthenticationObject;
}

function authentication_object_to_string(authentication_object: AuthenticationObject) {
	return `${authentication_object.algorithm}$` +
	       `${authentication_object.encoding}$` +
	       `${authentication_object.rounds}$` + 
	       `${authentication_object.hash_function}$` + 
	       `${authentication_object.hash_length}$` + 
	       `${authentication_object.salt.toString(authentication_object.encoding)}$` + 
	       `${authentication_object.hash.toString(authentication_object.encoding)}`;
}

function algorithm_to_string(algo: Algorithm): string {
	switch (algo) {
		case Algorithm.PBKDF2:
			return "pbkdf2";
	}
}

export class WrongCredentialsError extends Error {
	constructor(extra_info: string) {
		super(extra_info);
		this.name = "WrongCredentialsError";
	}
}

export class InvalidAuthenticationString extends Error {
	constructor(extra_info: string) {
		super(extra_info),
		this.name = "InvalidAuthenticationString";
	}
}

export interface UserServiceConfig {
	algorithm: Algorithm;
	rounds: number;
	encodings: BufferEncoding[]
	preferred_encoding: BufferEncoding;
	salt_length: number;
	digest: "sha512",
	keylen: number
}

function get_key_len(digest: string): number {
	if (digest == "sha512") {
		return 64;
	} else {
		return -1;
	}
}

export class AuthenticationService<T> implements Service {
	private data_id: string | null;
	private session_service: SessionService;
	private storage: UserStorage<T>;
	private config: UserServiceConfig;

	constructor(service_network: ServiceNetwork, storage: UserStorage<T>, config: UserServiceConfig) {
		this.data_id = null;
		this.session_service = service_network.get_by_type(SessionService);
		this.config = config;
		this.storage = storage;
	}

	create_middleware(data_id: string): Array<koa.Middleware> {
		this.data_id = data_id;
		return [async (ctx: koa.Context, next: koa.Next) => {
			if (this.data_id == null) {
				throw new Error("Middleware has not been added correctly");
			}
			await next();
		}];
	}
	/**
	 * Gets the user object for the session of the context, if not logged in it returns null
	 * @param ctx the koa context
	 * @returns The user object or null if not logged in
	 */
	async get_user(ctx: koa.Context): Promise<T | null> {
		let session = await this.session_service.get_session(ctx);
		let user_id = parse_int_safe(session.get("user_id"));

		if (Number.isNaN(user_id)) {
			return null;
		}

		let user_data = await this.storage.get_by_id(user_id);
		if (user_data == null) {
			//Dont know if i should throw a error here, the user could just have been deleted
			console.warn("Session had a user id that wasnt valid");
			return null;
		}

		return user_data;
	}

	/**
	 * Authenticates a request which sets the user_id in the session so that the session is logged in
	 * @param ctx the context of the request that sent the login request
	 * @param stored_authentication should be a string, but in case that the authentication string is nullable, this makes it easier
	 * @param password
	 * @throws {WrongCredentialsError} if the username or password is wrong
	 * @throws {InvalidAuthenticationString} If the authentication string is corrupt
	 */
	async authenticate(ctx: koa.Context, user_id: number, stored_authentication_string: string | null | undefined, password: string) {
		if (stored_authentication_string == null) {
			throw new InvalidAuthenticationString("authentication string was null");
		}
		let session = await this.session_service.get_session(ctx);

		if (!(await safe_verify_authentication_string(stored_authentication_string, password, this.config.encodings))) {
			throw new WrongCredentialsError("Wrong password");
		}

		session.set("user_id", user_id.toString());
	}

	/**
	 * Authenticates a request which sets the user_id in the session so that the session is logged in, this version doesnt throw errors, instead it just returns null on error
	 * @param ctx the context of the request that sent the login request
	 * @param stored_authentication_string the authentication string for the account
	 * @param password the password of the account
	 * @return userdata in case of success and null in case of error
	 */
	async try_authenticate(ctx: koa.Context, user_id: number, stored_authentication_string: string, password: string): Promise<boolean> {
		try {
			await this.authenticate(ctx, user_id, stored_authentication_string, password);
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Creates a authentication stirng for the supplied password
	 * @param password the password
	 * @returns a authentication string corresponding to the password
	 */
	async create_authentication_string(password: string): Promise<string> {
		let salt = randomBytes(this.config.salt_length);
		let authentication_object: AuthenticationObject = {
			algorithm: this.config.algorithm,
			encoding: this.config.preferred_encoding,
			rounds: this.config.rounds,
			hash_function: this.config.digest,
			hash_length: this.config.keylen,
			salt: salt,
			hash: await (new Promise<Buffer>((resolve, reject) => {
				pbkdf2(password, salt, this.config.rounds, this.config.keylen, this.config.digest, (err, key) => {
					if (err == null) {
						resolve(key);
					} else {
						reject(err);
					}
				})
			}))
		}
		return authentication_object_to_string(authentication_object);
	}
}