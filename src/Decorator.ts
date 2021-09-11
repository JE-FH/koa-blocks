import * as koa from "koa";
import * as Router from "@koa/router";
import { transformAndValidate } from "class-transformer-validator";
export {ValidationError} from "class-validator";

type ParamValidator = (new (...args: any[]) => any) | null;
type QueryValidator = (new (...args: any[]) => any) | null;
type BodyValidator = (new (...args: any[]) => any) | null;

type ValidatorType = [ParamValidator, QueryValidator, BodyValidator];

interface ValidatedRequest<Param, Query, Body> extends koa.Request {
	vparam: Param;
	vquery: Query;
	vbody: Body;
}

export interface ValidatedContext<Param, Query, Body, State = koa.DefaultState> extends koa.ParameterizedContext<State> {
	request: ValidatedRequest<Param, Query, Body>;
}

interface Handler {
	path: string;
	handler: (...args: any[]) => any;
	o_handler?: (...args: any[]) => any;
	method: "get" | "post" | "put" | "patch" | "delete" | "use";
	validator?: ValidatorType;
};

type RouteMap = Array<Handler>;

function assert_route_map(target: any): asserts target is {__route_map: RouteMap} {
	if (target.__route_map == undefined) {
		target.__route_map = [];
	}
}

/**
 * Decorator, sets up a get route on the given path with the target function as the handler
 * @param path the path for the page
 */
export function Get(path: string): Function;
/**
 * Decorator, sets up a get route on the given path with the target function as the handler
 * @param path the path for the page
 * @param validator the validator class used for the query and param objects
 */
export function Get(path: string, validator: ValidatorType): Function;
export function Get(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "get", validator});
	}
}

/**
 * Decorator, sets up a post route on the given path with the target function as the handler
 * @param path the path for the page
 */
export function Post(path: string): Function;
/**
 * Decorator, sets up a post route on the given path with the target function as the handler
 * @param path the path for the page
 * @param validator the validator class used for the query, param and post objects
 */
export function Post(path: string, validator: ValidatorType): Function;
export function Post(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "post", validator});
	}
}

/**
 * Decorator, sets up a put route on the given path with the target function as the handler
 * @param path the path for the page
 */
export function Put(path: string): Function;
/**
 * Decorator, sets up a put route on the given path with the target function as the handler
 * @param path the path for the page
 * @param validator the validator class used for the query and param objects
 */
export function Put(path: string, validator: ValidatorType): Function;
export function Put(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "put", validator});
	}
}

/**
 * Decorator, sets up a patch route on the given path with the target function as the handler
 * @param path the path for the page
 */
export function Patch(path: string): Function;
/**
 * Decorator, sets up a patch route on the given path with the target function as the handler
 * @param path the path for the page
 * @param validator the validator class used for the query and param objects
 */
export function Patch(path: string, validator: ValidatorType): Function;
export function Patch(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "patch", validator});
	}
}

/**
 * Decorator, sets up a delete route on the given path with the target function as the handler
 * @param path the path for the page
 */
export function Delete(path: string): Function;
/**
 * Decorator, sets up a delete route on the given path with the target function as the handler
 * @param path the path for the page
 * @param validator the validator class used for the query and param objects
 */
export function Delete(path: string, validator: ValidatorType): Function;
export function Delete(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "delete", validator});
	}
}

/**
 * Decorator, sets up a use route on the given path with the target function as the handler
 * Note: This wont get called if there is no handler that isnt use on the same path
 * That means that this cant be used as a 404 handler since if there is no actual path
 * this doesnt get called, this is an issue with koa-router and cant be fixed here
 * The work around is to give the use handler a path like /* which catches any path
 */
export function Use(): Function; 
/**
 * Decorator, sets up a use route on the given path with the target function as the handler
 * Note: This wont get called if there is no handler that isnt use on the same path
 * That means that this cant be used as a 404 handler since if there is no actual path
 * this doesnt get called, this is an issue with koa-router and cant be fixed here
 * The work around is to give the use handler a path like /* which catches any path
 * @param path the path for the page
 */
export function Use(path: string): Function; 
export function Use(path?: string): Function {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path: path ?? "", handler: descriptor.value, method: "use"});
	}
}
export class Controller {
	__router: Router;
	constructor() {
		assert_route_map(this);
		this.__router = new Router();
		for (let route of this.__route_map) {
			route.o_handler = route.handler.bind(this);

			if (route.method == "use") {
				if (route.path == "")
					this.__router.use(route.o_handler);
				else
					this.__router.use(route.path, route.o_handler);
				continue;
			}

			if (route.validator != undefined) {
				route.handler = async (ctx: Router.RouterContext) => {
					let mod_ctx = ctx as unknown as ValidatedContext<any, any, any>;
					
					mod_ctx.request.vparam = null;
					mod_ctx.request.vquery = null;
					mod_ctx.request.vbody = null;

					if (route.validator![0] != null) {
						mod_ctx.request.vparam = await transformAndValidate(route.validator![0], ctx.params);
						if (!(mod_ctx.request.vparam instanceof route.validator![0])) {
							throw new Error("Big error :(");
						}
					}
					
					if (route.validator![1] != null) {
						let parsed_query: Record<string, string | string[]> = {};
						for (const key of Object.keys(ctx.query)) {
							parsed_query[key] = ctx.query[key]!;
						}
						mod_ctx.request.vquery = await transformAndValidate(route.validator![1], parsed_query);
						if (!(mod_ctx.request.vquery instanceof route.validator![1])) {
							throw new Error("Big error :(");
						}
					}

					if (route.validator![2] != null) {
						if (typeof ctx.request.body == "object") {
							mod_ctx.request.vbody = await transformAndValidate(route.validator![2], ctx.request.body);
							if (!(mod_ctx.request.vbody instanceof route.validator![2])) {
								throw new Error("Big error :(");
							}
						}
					} 

					mod_ctx.body = await route.o_handler!(mod_ctx);
				}
			} else {
				route.handler = async (ctx: koa.Context) => {
					ctx.body = await route.o_handler!(ctx);
				}
			}


			switch (route.method) {
				case "get":
					this.__router.get(route.path, route.handler);
					break;
				case "post":
					this.__router.post(route.path, route.handler);
					break;
				case "put":
					this.__router.put(route.path, route.handler);
					break;
				case "patch":
					this.__router.patch(route.path, route.handler);
					break;
				case "delete":
					this.__router.delete(route.path, route.handler);
					break;
			}
		}
	}

	get_router(): Router {
		return this.__router;
	}

	get_routes() {
		return this.__router.routes();

	}
}