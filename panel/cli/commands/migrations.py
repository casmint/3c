import json


async def dispatch(args, service):
    if args.migration_command == "plan": return await service.plan(args.actor, args.domains)
    if args.migration_command == "create-zones": return await service.create_zones(args.actor, args.plan_id, args.idempotency_key)
    if args.migration_command == "apply-nameservers": return await service.apply_nameservers(args.actor, args.plan_id, args.domains, json.loads(args.expected_nameservers_json), args.confirm, args.idempotency_key)
    if args.migration_command == "status": return await service.migration_status(args.actor, args.plan_id, args.domains)
    raise ValueError("unknown migrations command")
