from yardstick_benchmark.model import RemoteApplication, Node
from pathlib import Path
from datetime import timedelta

class ComplexWalkAround(RemoteApplication):
    def __init__(
        self,
        nodes: list[Node],
        server_host: str,
        duration: timedelta = timedelta(seconds=60),
        spawn_x: int = 0,
        spawn_y: int = 0,
        box_width: int = 32,
        box_x: int = -16,
        box_z: int = -16,
        bots_join_delay: timedelta = timedelta(seconds=5),
        bots_per_node: int = 10,
    ):
        
        workload_template = Path(__file__).parent

        super().__init__(
            "complex_walkaround",
            nodes,
            workload_template / "complex_deploy.yml",
            workload_template / "complex_start.yml",
            workload_template / "complex_stop.yml",
            workload_template / "complex_cleanup.yml",
            extravars={
                "hostnames": [n.host for n in nodes],
                "mc_host": server_host,
                "bots_per_node": bots_per_node,
                # realistic workload knobs
                "radius": 800,
                "goal_interval": 20,
                "build_interval": 7,
                "mine_interval": 11,
                "flush_every": 60,
                "rcon_port": 25575,
                "rcon_password": "password",
                # (optionally) wd_base like you did for DiskLoad
                # "wd_base": yardstick_base,
                "workload_template": str(workload_template),
            },
        )