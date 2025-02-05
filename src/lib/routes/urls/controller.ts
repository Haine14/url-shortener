import { ExtendedError } from "#lib/exceptions";
import { HttpCode } from "#lib/types";
import { auth, isBlockedHostname, isHealthy, shorten, tokenAuth } from "#lib/utils";
import { isExisted } from "#lib/utils";
import { FastifyInstance } from "fastify";

export async function home(fastify: FastifyInstance) {
    fastify
        .route({
            method: "GET",
            url: "/health",
            handler: async (req, reply) => reply.code(HttpCode["OK"]).send(await isHealthy(fastify)),
        })
        .route({
            method: "GET",
            url: "/favicon.ico",
            handler: (req, reply) => reply.code(HttpCode["No Content"]),
        })
        .route({
            method: "GET",
            url: "/stats",
            handler: async function (req, reply) {
                let [urls, visitsData] = await fastify.db.$transaction([
                    fastify.db.shortened.count({ where: { blocked: false } }),
                    fastify.db.shortened.findMany({ where: { blocked: false }, select: { visits: true } }),
                ]);
                let visits = visitsData.reduce((prev, curr) => prev + curr.visits.length, 0);

                return reply.type("application/json").send({ urls, visits });
            },
        })
        .route({
            method: "GET",
            url: "/",
            handler: async (req, reply) =>
                new ExtendedError(`Route ${String(req.raw.method).toUpperCase()}:${req.raw.url} not found`, HttpCode["Not Found"]),
        });
}

export async function urls(fastify: FastifyInstance) {
    fastify
        .route<{ Body: { url: string } }>({
            method: "POST",
            url: "/shorten",
            config: { rateLimit: { max: 10, timeWindow: "5s" } },
            preHandler: fastify.auth([tokenAuth]),
            handler: async function (req, reply) {
                const baseUrl = `${process.env.BASE_URL ? process.env.BASE_URL : `${req.protocol}://${req.hostname}`}`;
                const inputUrl = req.body?.url;
                if (!inputUrl) throw new ExtendedError("Please enter a url", HttpCode["Bad Request"]);
                isBlockedHostname(inputUrl, req.hostname);

                const existedId = await isExisted(fastify, inputUrl);
                if (existedId)
                    return reply
                        .type("application/json")
                        .code(HttpCode["OK"])
                        .send({ short: existedId, url: new URL(existedId, baseUrl).toString() });

                const id = await shorten(fastify, req.user.id, inputUrl);
                const url = new URL(id, baseUrl);

                return reply.type("application/json").code(HttpCode["Created"]).send({ short: id, url: url.toString() });
            },
        })
        .route<{ Params: { short: string } }>({
            method: "GET",
            url: "/:short",
            handler: async function (req, reply) {
                const now = new Date();
                const code = Buffer.from(req.params.short, "ascii").toString("base64url");
                const data = await fastify.db.shortened.findUnique({
                    where: { code },
                    select: { url: true, visits: true },
                });
                if (!data) throw new ExtendedError("Shortened URL not found in database", HttpCode["Not Found"]);

                await fastify.db.shortened.update({
                    where: { code },
                    data: { visits: { push: now } },
                });

                return reply.redirect(HttpCode["Permanent Redirect"], data.url);
            },
        })
        .route<{ Params: { short: string } }>({
            method: "GET",
            url: "/:short-",
            handler: async function (req, reply) {
                const code = Buffer.from(req.params.short, "ascii").toString("base64url");
                const data = await fastify.db.shortened.findUnique({
                    where: { code },
                    select: { url: true, visits: true },
                });
                if (!data) throw new ExtendedError("Shortened URL not found in database", HttpCode["Not Found"]);

                return reply.type("application/json").send({ url: data.url, visits: data.visits });
            },
        });
}
