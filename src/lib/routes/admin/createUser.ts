import { ExtendedError } from "#lib/exceptions";
import { HttpCode } from "#lib/types";
import { randomBytes as random } from "crypto";
import { adminAuth, encode, hashSecret, tokenAuth } from "#lib/utils";
import { FastifyInstance } from "fastify";
import { Snowflake } from "@sapphire/snowflake";
import { logger } from "#root/index";

const snowflake = new Snowflake(1118707200000);

export async function createUser(fastify: FastifyInstance) {
    fastify.route<{ Params: { name: string }; Body: { pass: string; admin: string } }>({
        url: "/:name",
        method: "POST",
        preHandler: fastify.auth([tokenAuth, adminAuth]),
        handler: async function (req, reply) {
            const { name } = req.params;
            const { pass, admin } = req.body
            if (!pass) throw new ExtendedError("Password missing", HttpCode["Bad Request"]);
            if (!admin) throw new ExtendedError("Specify whether this user is an admin", HttpCode["Bad Request"]);
            const isAdmin = ["true", true, "y", "yes", "1", 1].includes(admin);
            return fastify.db.users.findFirst({ where: { name: name.toLowerCase() } }).then(async (user) => {
                if (user !== null) throw new ExtendedError("User already exists", HttpCode["Conflict"]);
                const salt = encode(random(16));
                const password = hashSecret(pass, salt);
                await fastify.db.users.create({
                    data: { id: snowflake.generate().toString(), admin: isAdmin, salt, password, name: name.toLowerCase() },
                });
                logger.debug(`[${name.toLowerCase()}]`);
                reply.type("application/json").send({ success: true });
            });
        },
    });
}
