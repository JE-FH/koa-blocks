import koa = require("koa");

export interface Service {
	/**
	 * Should create all the middlewares needed for this service
	 * @param storage_id The key that data should be stored in for every request that goes through the middleware eg. an id of data_1 would mean that data should be stored in `req.state["data_1"]`
	 * @returns the array of middleware or none if no middlewares are needed
	 */
	create_middleware?(storage_id: string): Array<koa.Middleware>;
}

type ClassConstructor<T> = ( new (...args: any[]) => T );

interface ServiceDesc<T> {
	service_type: ClassConstructor<T>;
	service: T;
	middleware_added: boolean;
};


export class ServiceNetwork {
	private last_id: number;	
	services: Map<string, ServiceDesc<Service>>;

	constructor() {
		this.last_id = 0;
		this.services = new Map();
	}

	/**
	 * Creates middleware for all the services that require middleware for the given app
	 * @param app the app to add the middleware to
	 */
	add_middleware(app: koa) {
		this.services.forEach((service, key) => {
			if (service.service.create_middleware == null || service.middleware_added) {
				return;
			}
			let middlewares = service.service.create_middleware(`data_${(this.last_id++)}`);
			middlewares.forEach((middleware) => {
				app.use(middleware);
			});
		});
	}

	add_service_custom_name<T extends Service>(name: string, service_type: ClassConstructor<T>, service: T): void {
		if (this.services.has(name)) {
			throw new Error("Service already exists with same name");
		}
		this.services.set(name, {service_type: service_type, middleware_added: false, service});
	}

	//Service will have the name of the class
	add_service<T extends Service>(service_type: ClassConstructor<T>, service: T): void {
		let name = service_type.prototype.constructor.name;
		this.add_service_custom_name(name, service_type, service);
	}

	get_service<T extends Service>(service_name: string, service_type: ClassConstructor<T>): T {
		let service = this.services.get(service_name)?.service;
		if (service == null) {
			throw new Error(`Requested service "${service_name}" does not exist`);
		}
		if (!(service instanceof service_type)) {
			throw new Error("Requested service does not have the expected type");
		}
		return service;
	}

	get_by_type<T extends Service>(service_type: ClassConstructor<T>): T {
		let name = service_type.prototype.constructor.name;
		return this.get_service<T>(name, service_type);
	}
}