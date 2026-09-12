"""GraphQL schema.

Deliberately trivial for now: step 0 proves the deployment path, not the
domain. The family tree types land once the pipeline is real.
"""

import strawberry


@strawberry.type
class Query:
    @strawberry.field
    def status(self) -> str:
        """Liveness probe reachable through GraphQL as well as REST."""
        return "ok"


schema = strawberry.Schema(query=Query)
