import koa = require("koa");

export interface Service {
	/**
	 * Should create all the middlewares needed for this service
	 * @param storage_id The key that data should be stored in for every request that goes through the middleware eg. an id of data_1 would mean that data should be stored in `req.state["data_1"]`
	 * @returns the array of middleware or none if no middlewares are needed
	 */
	create_middleware(storage_id: string): Array<koa.Middleware>;
}

export class PassiveService implements Service {
	create_middleware(storage_id: string): Array<koa.Middleware> {return [];}
}

type ClassConstructor<T> = ( new (...args: any[]) => T );

interface ServiceDesc<T> {
	service_type: ClassConstructor<T>;
	service: T;
	middleware_added: boolean;
};

const DOMAIN = "SN_DATA_";

export class ServiceNetwork {
	private last_id: number;	
	private assert_instance: boolean;
	services: Map<string, ServiceDesc<Service>>;

	constructor(assert_instance?: boolean) {
		this.last_id = 0;
		this.services = new Map();
		this.assert_instance = assert_instance ?? true;
	}

	/**
	 * Creates middleware for all the services that require middleware
	 */
	create_middleware(): Array<koa.Middleware> {
		let rv: Array<koa.Middleware> = [];
		this.services.forEach((service, key) => {
			if (service.service.create_middleware == null || service.middleware_added) {
				return;
			}
			let middlewares = service.service.create_middleware(`${DOMAIN}${this.last_id++}`);
			middlewares.forEach((middleware) => {
				rv.push(middleware);
			});
		});
		return rv;
	}

	add_service_custom_name<T extends Service>(name: string, service_type: ClassConstructor<T>, service: T): T {
		if (this.services.has(name)) {
			throw new Error("Service already exists with same name");
		}
		this.services.set(name, {service_type: service_type, middleware_added: false, service});
		return service;
	}

	//Service will have the name of the class
	add_service<T extends Service>(service_type: ClassConstructor<T>, service: T): T {
		let name = service_type.prototype.constructor.name;
		this.add_service_custom_name(name, service_type, service);
		return service;
	}

	get_service<T extends Service>(service_name: string, service_type: ClassConstructor<T>): T {
		let service = this.services.get(service_name)?.service;
		if (service == null) {
			throw new Error(`Requested service "${service_name}" does not exist`);
		}
		if (this.assert_instance && !(service instanceof service_type)) {
			throw new Error("Requested service does not have the expected type");
		}
		return service as T;
	}

	get_by_type<T extends Service>(service_type: ClassConstructor<T>): T {
		let name = service_type.prototype.constructor.name;
		return this.get_service<T>(name, service_type);
	}
}