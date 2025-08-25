from yardstick_benchmark.model import RemoteApplication, Node
from pathlib import Path

class DiskLoad(RemoteApplication):
    def __init__(
        self,
        nodes: list[Node],
        server_host: str,
        teleport_interval: float,
        radius: int,
        bots_per_node: int = 1,
    ):
        workload_template = Path(__file__).parent

        super().__init__(
            "diskload",
            nodes,
            workload_template / "diskload_deploy.yml",
            workload_template / "diskload_start.yml",
            workload_template / "diskload_stop.yml",
            workload_template / "diskload_cleanup.yml",
            extravars={
                "hostnames": [n.host for n in nodes],
                "mc_host":    server_host,
                "teleport_interval": teleport_interval,
                "radius": radius,
                "bots_per_node": bots_per_node,
                "workload_template": str(workload_template),
            },
        )