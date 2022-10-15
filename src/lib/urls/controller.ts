import { ExtendedError } from "#lib/exceptions";
import { HttpCode } from "#lib/types";
import { auth, isBlockedHostname, shorten } from "#lib/utils";
import { FastifyInstance } from "fastify";

export async function urls(fastify: FastifyInstance) {
    fastify
        .route<{ Body: { url: string } }>({
            method: "POST",
            url: "/",
            handler: async function (req, reply) {
                const url = req.body?.url;
                if (!url) throw new ExtendedError("Please enter a url", HttpCode["Bad Request"]);
                isBlockedHostname(url);

                let id = await shorten(fastify, url);
                let baseUrl = process.env.BASE_URL ? process.env.BASE_URL : `${req.protocol}://${req.hostname}`;

                reply
                    .type("application/json")
                    .code(HttpCode["Created"])
                    .send({ short: id, url: `${baseUrl}/${id}` });
            },
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
                const data = await fastify.db.shortened.findMany({ select: { visits: true, code: true } });

                let visitsStats = data.reduce((prev, curr) => prev + curr.visits.length, 0);

                reply.type("application/json").send({ urls: data.length, visits: visitsStats });
            },
        })
        .route({
            method: "GET",
            url: "/",
            handler: (req, reply) =>
                new ExtendedError(`Route ${String(req.method).toUpperCase()}:${req.url} not found`, HttpCode["Not Found"]),
        })
        .route<{ Params: { short: string } }>({
            method: "GET",
            url: "/:short",
            handler: async function (req, reply) {
                const code = Buffer.from(req.params.short, "ascii").toString("base64url");
                const data = await fastify.db.shortened.findUnique({
                    where: { code },
                    select: { url: true, visits: true },
                });
                if (!data) throw new ExtendedError("Shortened URL not found in database", HttpCode["Not Found"]);

                await fastify.db.shortened.update({
                    where: { code },
                    data: { visits: { push: new Date() } },
                });

                reply.redirect(HttpCode["Permanent Redirect"], data.url);
            },
        })
        .route<{ Params: { short: string } }>({
            method: "GET",
            url: "/:short/stats",
            handler: async function (req, reply) {
                const code = Buffer.from(req.params.short, "ascii").toString("base64url");
                const data = await fastify.db.shortened.findUnique({
                    where: { code },
                    select: { url: true, visits: true },
                });
                if (!data) throw new ExtendedError("Shortened URL not found in database", HttpCode["Not Found"]);

                reply.type("application/json").send({ url: data.url, visits: data.visits.map((date) => date.getTime()) });
            },
        });
}
