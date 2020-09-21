import * as koa from "koa";
import * as Router from "koa-router";
import { transformAndValidate } from "class-transformer-validator";
import * as bodyParser from "koa-bodyparser";
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

export interface ValidatedContext<Param, Query, Body> extends koa.Context {
	request: ValidatedRequest<Param, Query, Body>;
}

interface Handler {
	path: string;
	handler: (...args: any[]) => any;
	o_handler?: (...args: any[]) => any;
	method: "get" | "post" | "put" | "patch" | "delete" | "del" | "use";
	validator?: ValidatorType;
};

type RouteMap = Array<Handler>;

function assert_route_map(target: any): asserts target is {__route_map: RouteMap} {
	if (target.__route_map == undefined) {
		target.__route_map = [];
	}
}

export function Get(path: string): Function;
export function Get(path: string, validator: ValidatorType): Function;
export function Get(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "get", validator});
	}
}

export function Post(path: string): Function;
export function Post(path: string, validator: ValidatorType): Function;
export function Post(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "post", validator});
	}
}

export function Put(path: string): Function;
export function Put(path: string, validator: ValidatorType): Function;
export function Put(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "put", validator});
	}
}

export function Patch(path: string): Function;
export function Patch(path: string, validator: ValidatorType): Function;
export function Patch(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "patch", validator});
	}
}

export function Delete(path: string): Function;
export function Delete(path: string, validator: ValidatorType): Function;
export function Delete(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "delete", validator});
	}
}

export function Del(path: string): Function;
export function Del(path: string, validator: ValidatorType): Function;
export function Del(path: string, validator?: ValidatorType) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		assert_route_map(target);
		target.__route_map.push({path, handler: descriptor.value, method: "del", validator});
	}
}

export function Use(path?: string) {
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
					}
					
					if (route.validator![1] != null) {
						let parsed_query: Record<string, string | string[]> = {};
						for (const key of Object.keys(ctx.query)) {
							parsed_query[key] = ctx.query[key];
						}
						mod_ctx.request.vquery = await transformAndValidate(route.validator![1], parsed_query);
					}

					if (route.validator![2] != null) {
						mod_ctx.request.vbody = await transformAndValidate(route.validator![2], ctx.request.body);
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
				case "del":
					this.__router.del(route.path, route.handler);
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