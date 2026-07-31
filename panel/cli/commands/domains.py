async def dispatch(args, service):
    if args.domain_command == "list": return await service.list_domains(args.filter, args.cursor, args.limit)
    if args.domain_command == "status": return await service.domain_status(args.domain)
    raise ValueError("unknown domains command")
