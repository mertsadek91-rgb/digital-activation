import { type INestApplication, RequestMethod, type Type } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import {
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiResponse,
  DocumentBuilder,
  type OpenAPIObject,
  type ReferenceObject,
  type SchemaObject,
  SwaggerModule,
} from '@nestjs/swagger';
import * as contracts from '@da/contracts';
import { z, type ZodType } from 'zod';

import { ZodPipe } from './zod.pipe.js';

/**
 * The OpenAPI document, generated from the zod schemas the routes already
 * validate with.
 *
 * Nest's Swagger module describes a request by reflecting on the TypeScript
 * type of each handler parameter. Every parameter here is typed with a
 * `z.infer<…>` alias, which reflection sees as `Object`, so on its own the
 * document said "some object" for every body in the API. Writing class DTOs
 * for Swagger would be a second definition of every shape — the thing the
 * contracts package exists to prevent — so the document is fed from zod
 * instead:
 *
 *  - Requests need nothing at the call site. Each `ZodPipe` already holds the
 *    schema it enforces, and Nest records the pipes per parameter, so the
 *    body, query and path schemas are read straight off the route metadata.
 *    What the spec says a route accepts is, by construction, what it accepts.
 *  - Responses cannot be inferred — the reflected return type is `Promise` —
 *    so a handler names its schema with `@ZodResponse(cartSchema)`.
 *
 * Every schema exported from `@da/contracts` is registered as a named
 * component (`cartSchema` → `Cart`). Where a shape reads differently going in
 * — a `.default()` field is optional in a request and always present in a
 * response — the request side gets its own `…Request` twin. Only the
 * components a route actually reaches are kept.
 */

const ZOD_RESPONSES = 'da:zod-responses';
const ANNOTATED = 'da:openapi-annotated';

interface ZodResponseEntry {
  schema: ZodType;
  status: number | undefined;
  description: string;
}

/**
 * Declares the zod schema a handler's response has, for the OpenAPI document.
 *
 * Metadata only: nothing is converted until a document is built, which never
 * happens in production, so the decorator costs a boot nothing there.
 */
export function ZodResponse(
  schema: ZodType,
  options: { status?: number; description?: string } = {},
): MethodDecorator {
  return (_target, _key, descriptor) => {
    const handler = descriptor.value as object;
    const existing = (Reflect.getMetadata(ZOD_RESPONSES, handler) ?? []) as ZodResponseEntry[];
    Reflect.defineMetadata(
      ZOD_RESPONSES,
      [
        ...existing,
        { schema, status: options.status, description: options.description ?? 'Success' },
      ],
      handler,
    );
  };
}

type Io = 'input' | 'output';
type Schema = SchemaObject | ReferenceObject;

// OpenAPI 3.0 is what @nestjs/swagger emits; zod can write that dialect
// directly rather than JSON Schema that viewers half-understand. A transform's
// output has no JSON Schema, and "any" is a truer answer than a build failure.
const CONVERT = { target: 'openapi-3.0', unrepresentable: 'any' } as const;

/**
 * Suffix of a component's request-side twin, where it has one. Not "Input":
 * several contracts are already called `…Input` (`salePreviewInputSchema`).
 */
const REQUEST = 'Request';

function isZod(value: unknown): value is ZodType {
  return typeof value === 'object' && value !== null && '_zod' in value && 'safeParse' in value;
}

function stripDialect(schema: Record<string, unknown>): SchemaObject {
  delete schema.$schema;
  return schema;
}

/** The contracts' schemas as named components, in both directions. */
class ZodComponents {
  private readonly names = new Map<ZodType, string>();
  private readonly schemas: Record<string, SchemaObject> = {};
  /** Ids whose request-side view differs from the response-side one. */
  private readonly twins: Set<string>;

  constructor() {
    const registry = z.registry<{ id: string }>();
    for (const [name, value] of Object.entries(contracts)) {
      // First name wins: a schema re-exported under an alias is one component.
      if (!name.endsWith('Schema') || !isZod(value) || this.names.has(value)) continue;
      const id = `${name.charAt(0).toUpperCase()}${name.slice(1, -'Schema'.length)}`;
      registry.add(value, { id });
      this.names.set(value, id);
    }

    const convert = (io: Io, suffix: string): Record<string, string> => {
      const { schemas } = z.toJSONSchema(registry, {
        ...CONVERT,
        io,
        // References between components point at the same direction's twin.
        uri: (id) => `#/components/schemas/${id}${suffix}`,
      });
      return Object.fromEntries(
        Object.entries(schemas).map(([id, schema]) => [
          id,
          JSON.stringify(stripDialect(schema as Record<string, unknown>)),
        ]),
      );
    };
    const output = convert('output', '');
    // A marker no export name can contain, so the input pass's references can
    // be told apart and renamed below without guessing at suffixes.
    const input = convert('input', '~in');
    const inRef = /"#\/components\/schemas\/([^"~]+)~in"/g;

    // Many shapes read the same in both directions, and a spec with `Locale`
    // and `LocaleRequest` side by side makes every client pick one for
    // nothing. A request-side twin is kept only where it really differs — an
    // object accepts unknown keys going in (the pipe strips them) and has a
    // closed set coming out; a default is optional in and always present out —
    // either in its own body or in something it references. Iterated to a
    // fixed point because that second condition is transitive.
    const refsOf = (json: string): string[] =>
      [...json.matchAll(inRef)].map((match) => match[1] ?? '');
    const differs = new Set(
      Object.keys(input).filter(
        (id) => (input[id] ?? '').replace(inRef, '"#/components/schemas/$1"') !== output[id],
      ),
    );
    for (let grew = true; grew;) {
      grew = false;
      for (const id of Object.keys(input)) {
        if (!differs.has(id) && refsOf(input[id] ?? '').some((ref) => differs.has(ref))) {
          differs.add(id);
          grew = true;
        }
      }
    }
    this.twins = differs;

    const pointAtTwins = (json: string): string =>
      json.replace(
        inRef,
        (_whole, id: string) => `"#/components/schemas/${id}${differs.has(id) ? REQUEST : ''}"`,
      );
    for (const [id, json] of Object.entries(output)) {
      this.schemas[id] = JSON.parse(json) as SchemaObject;
    }
    for (const id of differs) {
      this.schemas[`${id}${REQUEST}`] = JSON.parse(pointAtTwins(input[id] ?? '{}')) as SchemaObject;
    }
  }

  /** A `$ref` for a contracts schema; an inline schema for a local one. */
  ref(schema: ZodType, io: Io): Schema {
    const id = this.names.get(schema);
    if (!id) return this.inline(schema, io);
    const twin = io === 'input' && this.twins.has(id);
    return { $ref: `#/components/schemas/${id}${twin ? REQUEST : ''}` };
  }

  /** Always inline — for a query, whose properties become separate parameters. */
  inline(schema: ZodType, io: Io): SchemaObject {
    return stripDialect(z.toJSONSchema(schema, { ...CONVERT, io }));
  }

  /**
   * The components reachable from the document's paths.
   *
   * Everything in the contracts package is registered so references resolve,
   * but most of it is never sent over the wire by itself — setting documents,
   * block shapes — and a spec listing all of it buries the part a client needs.
   */
  reachableFrom(document: OpenAPIObject): Record<string, SchemaObject> {
    const pool: Record<string, unknown> = { ...document.components?.schemas, ...this.schemas };
    const kept: Record<string, SchemaObject> = {};
    const pending: unknown[] = [document.paths];
    while (pending.length > 0) {
      const node = pending.pop();
      if (Array.isArray(node)) {
        pending.push(...(node as unknown[]));
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string') {
            const id = value.replace('#/components/schemas/', '');
            if (!(id in kept) && id in pool) {
              kept[id] = pool[id] as SchemaObject;
              pending.push(pool[id]);
            }
          } else {
            pending.push(value);
          }
        }
      }
    }
    return kept;
  }
}

interface RouteArg {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

interface ContainerLike {
  getModules(): Map<string, { controllers: Map<unknown, { metatype: Type | null }> }>;
}

/**
 * Turns the zod metadata on every controller into Swagger's own decorators.
 *
 * Applied to the handlers before `createDocument` reads them, the same as if
 * `@ApiBody(…)` had been written by hand. Guarded so a second document built
 * in the same process does not list every parameter twice.
 */
function annotateRoutes(app: INestApplication, components: ZodComponents): void {
  // The same door @nestjs/swagger's own scanner uses to reach the controllers.
  const container = (app as unknown as { container: ContainerLike }).container;

  for (const module of container.getModules().values()) {
    for (const { metatype: controller } of module.controllers.values()) {
      if (!controller) continue;
      const proto = controller.prototype as object;

      for (const key of Object.getOwnPropertyNames(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, key);
        const handler = descriptor?.value as object | undefined;
        if (key === 'constructor' || !descriptor || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(ANNOTATED, handler)) continue;
        Reflect.defineMetadata(ANNOTATED, true, handler);

        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, key) ?? {}) as Record<
          string,
          RouteArg
        >;
        for (const [slot, arg] of Object.entries(args)) {
          const pipe = arg.pipes?.find((candidate) => candidate instanceof ZodPipe) as
            ZodPipe<unknown> | undefined;
          if (!pipe) continue;
          const name = typeof arg.data === 'string' ? arg.data : undefined;

          // The slot is "<paramtype>:<index>", named back through the enum's
          // reverse mapping; a custom decorator's slot is not numeric and
          // matches no branch.
          switch (RouteParamtypes[Number(slot.split(':')[0])]) {
            case 'BODY':
              ApiBody({ required: true, schema: components.ref(pipe.schema, 'input') })(
                proto,
                key,
                descriptor,
              );
              break;
            case 'PARAM':
              if (name) {
                ApiParam({ name, required: true, schema: components.inline(pipe.schema, 'input') })(
                  proto,
                  key,
                  descriptor,
                );
              }
              break;
            case 'QUERY': {
              if (name) {
                ApiQuery({
                  name,
                  required: false,
                  schema: components.inline(pipe.schema, 'input'),
                })(proto, key, descriptor);
                break;
              }
              // A whole-query schema is one parameter per property: that is
              // how a query string is described, and how clients generate it.
              const object = components.inline(pipe.schema, 'input');
              const required = new Set(object.required ?? []);
              for (const [property, schema] of Object.entries(object.properties ?? {})) {
                ApiQuery({ name: property, required: required.has(property), schema })(
                  proto,
                  key,
                  descriptor,
                );
              }
              break;
            }
          }
        }

        const responses = (Reflect.getMetadata(ZOD_RESPONSES, handler) ?? []) as ZodResponseEntry[];
        for (const response of responses) {
          // Nest answers a POST with 201 unless told otherwise, and the spec
          // has to name the status the route really returns.
          const httpCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          const status = response.status ?? httpCode ?? (method === RequestMethod.POST ? 201 : 200);
          ApiResponse({
            status,
            description: response.description,
            schema: components.ref(response.schema, 'output'),
          })(proto, key, descriptor);
        }
      }
    }
  }
}

/**
 * Builds the API's OpenAPI document from a constructed (not necessarily
 * listening, not necessarily connected) Nest application.
 *
 * Shared by the `/docs` page outside production and by `pnpm openapi`, which
 * writes the same document to a file without a database.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const components = new ZodComponents();
  annotateRoutes(app, components);

  const config = new DocumentBuilder()
    .setTitle('Digital Activation API')
    .setDescription(
      'Storefront and admin API. Request and response schemas are generated from @da/contracts.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    // The storefront's cart and customer session, and the admin's session,
    // all travel as httpOnly cookies rather than headers.
    .addCookieAuth('da_cart', { type: 'apiKey', in: 'cookie', name: 'da_cart' }, 'cart')
    .addCookieAuth('da_customer', { type: 'apiKey', in: 'cookie', name: 'da_customer' }, 'customer')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: components.reachableFrom(document),
  };
  return document;
}
