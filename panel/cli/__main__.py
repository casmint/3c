"""Console entry point for the trusted local 3cli operator interface."""
import argparse
import asyncio
import json
import sys

from panel.cli.commands import domains, migrations
from panel.cli.services.migration import MigrationService
from panel.cli.store import Store
from panel.cli.validation import safe_error
from panel.config import load_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="3cli", description="3C trusted local operator interface")
    parser.add_argument("--actor", required=True, help="Named operator accountable for this command")
    parser.add_argument("--db-path", default="/data/3cli.db", help=argparse.SUPPRESS)
    parser.add_argument("--max-batch", default=5, type=int, help=argparse.SUPPRESS)
    parser.add_argument("--plan-ttl", default=900, type=int, help=argparse.SUPPRESS)
    groups = parser.add_subparsers(dest="group", required=True)

    domain_group = groups.add_parser("domains"); domain_commands = domain_group.add_subparsers(dest="domain_command", required=True)
    domain_list = domain_commands.add_parser("list"); domain_list.add_argument("--filter"); domain_list.add_argument("--cursor", type=int, default=0); domain_list.add_argument("--limit", type=int, default=25)
    domain_status = domain_commands.add_parser("status"); domain_status.add_argument("domain")

    sites_group = groups.add_parser("sites"); sites_commands = sites_group.add_subparsers(dest="sites_command", required=True); sites_commands.add_parser("list")

    migration_group = groups.add_parser("migrations"); migration_commands = migration_group.add_subparsers(dest="migration_command", required=True)
    migration_plan = migration_commands.add_parser("plan"); migration_plan.add_argument("domains", nargs="+")
    create = migration_commands.add_parser("create-zones"); create.add_argument("--plan-id", required=True); create.add_argument("--idempotency-key", required=True)
    apply = migration_commands.add_parser("apply-nameservers"); apply.add_argument("--plan-id", required=True); apply.add_argument("--domains", nargs="+", required=True); apply.add_argument("--expected-nameservers-json", required=True); apply.add_argument("--idempotency-key", required=True); apply.add_argument("--confirm", action="store_true")
    status = migration_commands.add_parser("status"); status.add_argument("--plan-id"); status.add_argument("--domains", nargs="+")
    return parser


def make_service(args) -> MigrationService:
    from panel.api.cloudflare import CloudflareAPI
    from panel.api.porkbun import PorkbunAPI
    config = load_config()
    if not config.porkbun:
        raise RuntimeError("Porkbun is not configured in the 3C panel")
    cloudflare = CloudflareAPI(config.cloudflare.api_token, config.cloudflare.account_id)
    porkbun = PorkbunAPI(config.porkbun.api_key, config.porkbun.secret_api_key)
    return MigrationService(cloudflare, porkbun, Store(args.db_path), args.max_batch, args.plan_ttl)


async def dispatch(args, service):
    if args.group == "domains": return await domains.dispatch(args, service)
    if args.group == "sites": return await service.list_sites()
    if args.group == "migrations": return await migrations.dispatch(args, service)
    raise ValueError("unknown command group")


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = asyncio.run(dispatch(args, make_service(args)))
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(json.dumps({"error": safe_error(error), "type": type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
