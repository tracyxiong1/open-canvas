#!/usr/bin/env python3
"""Validate the normative Creator Canvas v1 examples and semantic invariants."""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schema" / "canvas-document-v1.schema.json"
EXAMPLE_PATHS = (
    ROOT / "examples" / "canvas-v1-three-shot.json",
    ROOT / "examples" / "canvas-v1-shot2-night.json",
)


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_draft(document: dict, draft: dict) -> None:
    nodes = {record["id"]: record for record in draft["nodes"]}
    edges = {record["id"]: record for record in draft["edges"]}
    jobs = {record["id"]: record for record in draft["jobs"]}
    assets = {record["id"]: record for record in document["assets"]}

    assert len(nodes) == len(draft["nodes"]), "duplicate node ID in draft"
    assert len(edges) == len(draft["edges"]), "duplicate edge ID in draft"
    assert len(jobs) == len(draft["jobs"]), "duplicate job ID in draft"

    triples: set[tuple[str, str, str]] = set()
    dependency = {node_id: [] for node_id in nodes}
    for edge in edges.values():
        source_id = edge["sourceNodeId"]
        target_id = edge["targetNodeId"]
        assert source_id in nodes and target_id in nodes, "cross-draft edge"
        assert source_id != target_id, "self-edge"
        triple = (edge["kind"], source_id, target_id)
        assert triple not in triples, "duplicate edge triple"
        triples.add(triple)
        source = nodes[source_id]
        target = nodes[target_id]
        if edge["kind"] == "dependency":
            assert target["spec"]["kind"] == "composition"
            dependency[source_id].append(target_id)
        else:
            assert source["spec"]["kind"] == target["spec"]["kind"] == "shot"

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        assert node_id not in visiting, "dependency cycle"
        if node_id in visited:
            return
        visiting.add(node_id)
        for target_id in dependency[node_id]:
            visit(target_id)
        visiting.remove(node_id)
        visited.add(node_id)

    for node_id in nodes:
        visit(node_id)

    for job in jobs.values():
        assert job["nodeId"] in nodes, "cross-draft job"
        assert set(job["outputAssetIds"]) <= assets.keys(), "unknown job asset"

    shots = [node for node in draft["nodes"] if node["spec"]["kind"] == "shot"]
    compositions = [
        node for node in draft["nodes"] if node["spec"]["kind"] == "composition"
    ]
    shot_fingerprints: dict[str, str] = {}
    for shot in shots:
        input_assets = [
            {
                "assetId": asset_id,
                "checksumSha256": assets[asset_id]["checksumSha256"],
            }
            for asset_id in shot["spec"]["inputAssetIds"]
        ]
        shot_fingerprints[shot["id"]] = canonical_sha256(
            {
                "schemaVersion": 1,
                "kind": "shot",
                "spec": shot["spec"],
                "inputAssets": input_assets,
            }
        )
        assert (
            shot["execution"]["inputFingerprint"] == shot_fingerprints[shot["id"]]
        ), "shot fingerprint mismatch"

    for composition in compositions:
        ordered_shots = shots
        dependencies = [
            {
                "nodeId": shot["id"],
                "inputFingerprint": shot_fingerprints[shot["id"]],
                "outputAssetIds": shot["execution"]["outputAssetIds"],
            }
            for shot in ordered_shots
        ]
        expected = canonical_sha256(
            {
                "schemaVersion": 1,
                "kind": "composition",
                "spec": composition["spec"],
                "dependencies": dependencies,
            }
        )
        assert composition["execution"]["inputFingerprint"] == expected

    for node in nodes.values():
        execution = node["execution"]
        assert set(execution["outputAssetIds"]) <= assets.keys()
        if execution["status"] != "dirty":
            job = jobs[execution["activeJobId"]]
            assert job["nodeId"] == node["id"]
            assert job["inputFingerprint"] == execution["inputFingerprint"]
            assert job["status"] == execution["status"]
            assert job["outputAssetIds"] == execution["outputAssetIds"]


def main() -> None:
    schema = json.loads(SCHEMA_PATH.read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    documents = [json.loads(path.read_text()) for path in EXAMPLE_PATHS]

    for path, document in zip(EXAMPLE_PATHS, documents, strict=True):
        errors = sorted(
            validator.iter_errors(document), key=lambda error: list(error.absolute_path)
        )
        assert not errors, "\n".join(
            f"{path}:{'/'.join(map(str, error.absolute_path))}: {error.message}"
            for error in errors
        )
        assert document["drafts"], "a project must contain at least one draft"
        draft_ids = [draft["id"] for draft in document["drafts"]]
        assert len(draft_ids) == len(set(draft_ids)), "duplicate draft ID"
        assert document["activeDraftId"] in draft_ids, "unknown active draft"
        drafts = {draft["id"]: draft for draft in document["drafts"]}
        asset_ids = [asset["id"] for asset in document["assets"]]
        assert len(asset_ids) == len(set(asset_ids)), "duplicate asset ID"
        for asset in document["assets"]:
            digest = asset["checksumSha256"].removeprefix("sha256:")
            assert asset["id"] == f"asset_sha256_{digest}"
            assert asset["path"] == f"assets/sha256/{digest}"
            if asset["origin"]["kind"] == "job":
                origin = asset["origin"]
                assert origin["draftId"] in drafts, "unknown origin draft"
                origin_jobs = {job["id"]: job for job in drafts[origin["draftId"]]["jobs"]}
                assert origin["jobId"] in origin_jobs, "unknown origin job"
                assert asset["id"] in origin_jobs[origin["jobId"]]["outputAssetIds"]
        for draft in document["drafts"]:
            if "sourceDraftId" in draft:
                assert draft["sourceDraftId"] in draft_ids
                assert draft["sourceDraftId"] != draft["id"]
            validate_draft(document, draft)
        print(f"PASS schema and semantics: {path.relative_to(ROOT)}")

    base, night = documents
    assert base["project"]["id"] == night["project"]["id"]
    assert night["revision"] == base["revision"] + 2
    assert len(base["drafts"]) == 1 and len(night["drafts"]) == 2
    source = night["drafts"][0]
    variation = night["drafts"][1]
    assert variation["sourceDraftId"] == source["id"]
    assert night["activeDraftId"] == variation["id"]
    assert source == base["drafts"][0], "source draft changed after copying"
    assert {node["id"] for node in source["nodes"]} == {
        node["id"] for node in variation["nodes"]
    }, "copy did not preserve draft-local node IDs"

    source_nodes = {node["title"]: node for node in source["nodes"]}
    variation_nodes = {node["title"]: node for node in variation["nodes"]}
    for title in ("Shot 1 — Arrival", "Shot 3 — Signal"):
        assert variation_nodes[title]["execution"] == source_nodes[title]["execution"]
    for title in ("Shot 2 — Crossing", "Final composition"):
        assert variation_nodes[title]["execution"]["status"] == "dirty"
        assert variation_nodes[title]["execution"]["outputAssetIds"] == []
        assert "activeJobId" not in variation_nodes[title]["execution"]
    assert variation["jobs"] == source["jobs"], "copied job history was discarded"
    assert night["assets"] == base["assets"], "copy duplicated shared assets"
    print("PASS draft copy, isolation, shared assets, and targeted invalidation")

    for label, mutation in (
        ("unsupported schema version", lambda value: value.update(schemaVersion=2)),
        ("unknown top-level field", lambda value: value.update(credential="forbidden")),
        (
            "absolute asset path",
            lambda value: value["assets"][0].update(path="/unsafe"),
        ),
        (
            "traversing asset path",
            lambda value: value["assets"][0].update(path="../unsafe"),
        ),
    ):
        candidate = copy.deepcopy(base)
        mutation(candidate)
        assert list(validator.iter_errors(candidate)), f"accepted {label}"
        print(f"PASS rejection: {label}")

    cross_draft = copy.deepcopy(night)
    cross_draft["drafts"][1]["edges"][0]["targetNodeId"] = (
        "node_019c8f55-9999-7000-8000-000000000999"
    )
    try:
        validate_draft(cross_draft, cross_draft["drafts"][1])
    except AssertionError as error:
        assert str(error) == "cross-draft edge"
    else:
        raise AssertionError("accepted cross-draft edge")
    print("PASS rejection: cross-draft edge")


if __name__ == "__main__":
    main()
