from yardstick_benchmark.model import RemoteApplication, Node
import os
from pathlib import Path


class PaperMC(RemoteApplication):
    def __init__(self, nodes: list[Node], version="1.20.1", build="58"):
        super().__init__(
            "papermc",
            nodes,
            Path(__file__).parent / "papermc_deploy.yml",
            Path(__file__).parent / "papermc_start.yml",
            Path(__file__).parent / "papermc_stop.yml",
            Path(__file__).parent / "papermc_cleanup.yml",
            extravars={
                "hostnames": [n.host for n in nodes],
                "papermc_template": str(Path(__file__).parent / "server.properties.j2"),
                 "papermc_version": version,
                "papermc_build": build,
            },
        )
