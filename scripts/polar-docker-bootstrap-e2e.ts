import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const polarRoot = process.env.PAAC_E2E_POLAR_ROOT ?? "/Users/abrissimon/projects/polar";
const instance = Number(process.env.PAAC_E2E_POLAR_DOCKER_INSTANCE ?? "1");
const apiUrl = process.env.PAAC_E2E_POLAR_API_URL ?? `http://localhost:${8100 + instance}`;
const polarSecret = process.env.PAAC_E2E_POLAR_SECRET ?? "super secret jwt secret";
const outputPath = resolve(process.cwd(), ".polar-e2e/current-org.json");

const token = `polar_oat_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHmac("sha256", polarSecret).update(token).digest("hex");
const suffix = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const slug = `paac-e2e-${suffix}`;

const python = String.raw`
import asyncio
import json
import os
import uuid
from datetime import UTC, datetime

from polar.kit.db.postgres import create_async_sessionmaker
from polar.postgres import create_async_engine
from sqlalchemy import select

from polar.models import Account, Organization, OrganizationAccessToken, User, UserOrganization
from polar.models.organization import OrganizationStatus, STATUS_CAPABILITIES
from polar.models.user_organization import OrganizationRole

async def main():
    org_id = uuid.UUID(os.environ["PAAC_E2E_ORG_ID"])
    account_id = uuid.UUID(os.environ["PAAC_E2E_ACCOUNT_ID"])
    token_id = uuid.UUID(os.environ["PAAC_E2E_TOKEN_ID"])
    slug = os.environ["PAAC_E2E_ORG_SLUG"]
    token_hash = os.environ["PAAC_E2E_TOKEN_HASH"]
    user_email = os.environ.get("PAAC_E2E_USER_EMAIL", "admin@polar.sh")

    engine = create_async_engine("script")
    sessionmaker = create_async_sessionmaker(engine)
    async with sessionmaker() as session:
        account = Account(id=account_id, currency="usd")
        organization = Organization(
            id=org_id,
            name=f"PAAC E2E {slug}",
            slug=slug,
            email=f"{slug}@polar.local",
            customer_invoice_prefix=slug.upper()[:32],
            account=account,
            status=OrganizationStatus.ACTIVE,
            capabilities={**STATUS_CAPABILITIES[OrganizationStatus.ACTIVE]},
            status_updated_at=datetime.now(UTC),
            feature_settings={
                "member_model_enabled": True,
                "seat_based_pricing_enabled": True,
                "account_review_v2_enabled": True,
            },
        )
        oat = OrganizationAccessToken(
            id=token_id,
            organization=organization,
            token=token_hash,
            comment="PAAC E2E",
            scope=" ".join([
                "organizations:read",
                "organizations:write",
                "products:read",
                "products:write",
                "benefits:read",
                "benefits:write",
                "meters:read",
                "meters:write",
                "files:read",
                "files:write",
            ]),
            expires_at=None,
        )
        user = (await session.execute(select(User).where(User.email == user_email))).unique().scalar_one_or_none()
        if user is None:
            raise RuntimeError(f"User not found: {user_email}")
        membership = UserOrganization(
            user=user,
            organization=organization,
            role=OrganizationRole.owner,
        )
        session.add_all([account, organization, oat, membership])
        await session.commit()
    await engine.dispose()
    print(json.dumps({"organizationId": str(org_id), "organizationSlug": slug, "accessTokenId": str(token_id)}))

asyncio.run(main())
`;

const run = async (command: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: polarRoot, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
    child.stdin.end(python);
  });

const main = async () => {
  const env = {
    ...process.env,
    PAAC_E2E_ORG_ID: randomUUID(),
    PAAC_E2E_ACCOUNT_ID: randomUUID(),
    PAAC_E2E_TOKEN_ID: randomUUID(),
    PAAC_E2E_ORG_SLUG: slug,
    PAAC_E2E_TOKEN_HASH: tokenHash,
    PAAC_E2E_USER_EMAIL: process.env.PAAC_E2E_USER_EMAIL ?? "admin@polar.sh",
  };

  const stdout = await run(
    "docker",
    [
      "compose",
      "-p",
      `polar-app-${instance}`,
      "-f",
      "dev/docker/docker-compose.dev.yml",
      "exec",
      "-T",
      "-e",
      "PAAC_E2E_ORG_ID",
      "-e",
      "PAAC_E2E_ACCOUNT_ID",
      "-e",
      "PAAC_E2E_TOKEN_ID",
      "-e",
      "PAAC_E2E_ORG_SLUG",
      "-e",
      "PAAC_E2E_TOKEN_HASH",
      "-e",
      "PAAC_E2E_USER_EMAIL",
      "api",
      "bash",
      "-lc",
      "cd /app/server && uv run python -",
    ],
    env,
  );
  const created = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
  const config = { ...created, apiUrl, accessToken: token };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(JSON.stringify(config, null, 2));
};

await main();
