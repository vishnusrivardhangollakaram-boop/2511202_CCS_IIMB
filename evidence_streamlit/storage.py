"""Session-isolated storage and an opt-in SQLAlchemy PostgreSQL repository.

No application records live in module globals. Production SQL schema creation is
an explicit administrator action (``python -m evidence_streamlit.storage init``),
not a side effect of opening the application. SQLite is supported only when a
repository is explicitly constructed by tests.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from typing import MutableMapping
from uuid import uuid4


class WorkspaceError(RuntimeError):
    """A controlled, safe-to-display application error."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def encode(value: object) -> str:
    """Stable JSON forbids NaN/infinite values that cannot be safely exchanged."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def checked_case(record: dict) -> str:
    if (
        len(record.get("evidence", [])) > 50
        or len(record.get("reviews", [])) > 20
        or len(record.get("events", [])) > 200
    ):
        raise WorkspaceError(
            "case_limit",
            "This case reached its evidence or history limit. Export it and open a new investigation.",
        )
    payload = encode(record)
    if len(payload.encode("utf-8")) > 1_000_000:
        raise WorkspaceError(
            "case_limit",
            "This case reached its 1 MB storage limit. Export it and open a new investigation.",
        )
    return payload


def _summary(record: dict) -> dict:
    result = deepcopy(record)
    result["evidenceCount"] = len(result.get("evidence", []))
    result["reviewCount"] = len(result.get("reviews", []))
    result.update(evidence=[], events=[], reviews=[], summary=True)
    return result


def _audit(record: dict, actor_id: str, event: dict) -> dict:
    return {
        "id": str(uuid4()),
        "caseId": record["id"],
        "ownerId": record["ownerId"],
        "actorId": actor_id,
        "version": record["version"],
        "event": deepcopy(event),
        "snapshot": deepcopy(record),
        "createdAt": record["updatedAt"],
    }


class SessionRepository:
    """Transient records within the caller's Streamlit session, never cross-session."""

    durable = False

    def __init__(self, state: MutableMapping):
        if "ccs_session_repository_v1" not in state:
            state["ccs_session_repository_v1"] = {
                "cases": {},
                "audit": [],
                "corpus": {},
                "rates": {},
            }
        if "ccs_session_repository_lock" not in state:
            state["ccs_session_repository_lock"] = threading.RLock()
        self.data = state["ccs_session_repository_v1"]
        self.lock = state["ccs_session_repository_lock"]

    def _reserve(self, data: dict) -> None:
        if len(encode(data).encode("utf-8")) > 48_000_000:
            raise WorkspaceError(
                "session_limit",
                "This temporary workspace reached its memory limit. Export your work or configure authenticated PostgreSQL storage.",
            )

    def get(self, owner: str, case_id: str, shared: bool = False) -> dict:
        with self.lock:
            record = self.data["cases"].get(case_id)
            if not record or record["ownerId"] != owner:
                raise WorkspaceError("case_not_found", "This case was not found in your workspace.")
            return deepcopy(record)

    def find_request(self, owner: str, request_id: str) -> dict | None:
        with self.lock:
            return next(
                (
                    deepcopy(row)
                    for row in self.data["cases"].values()
                    if row["ownerId"] == owner and row["requestId"] == request_id
                ),
                None,
            )

    def list_cases(self, owner: str) -> list[dict]:
        with self.lock:
            return [
                _summary(row)
                for row in sorted(
                    self.data["cases"].values(), key=lambda r: r["updatedAt"], reverse=True
                )
                if row["ownerId"] == owner
            ][:100]

    def list_reviews(self) -> list[dict]:
        return []  # A session cannot be a shared queue for a different browser/user.

    def create(self, record: dict, actor_id: str) -> tuple[dict, bool]:
        checked_case(record)
        with self.lock:
            existing = self.find_request(record["ownerId"], record["requestId"])
            if existing:
                if existing["requestHash"] != record["requestHash"]:
                    raise WorkspaceError(
                        "idempotency_conflict",
                        "This request identifier was already used for different content.",
                    )
                return existing, False
            if sum(r["ownerId"] == record["ownerId"] for r in self.data["cases"].values()) >= 100:
                raise WorkspaceError(
                    "session_limit",
                    "This temporary session has 100 cases. Export your work or use authenticated PostgreSQL storage.",
                )
            proposed = {
                **self.data,
                "cases": {**self.data["cases"], record["id"]: deepcopy(record)},
                "audit": [*self.data["audit"], _audit(record, actor_id, record["events"][0])],
            }
            self._reserve(proposed)
            self.data.update(proposed)
            return deepcopy(record), True

    def save(self, previous: dict, record: dict, actor_id: str, event: dict) -> dict:
        checked_case(record)
        with self.lock:
            current = self.data["cases"].get(previous["id"])
            if (
                not current
                or current["ownerId"] != previous["ownerId"]
                or current["version"] != previous["version"]
            ):
                raise WorkspaceError(
                    "version_conflict",
                    "This case changed. Refresh it before submitting your decision.",
                )
            proposed = {
                **self.data,
                "cases": {**self.data["cases"], record["id"]: deepcopy(record)},
                "audit": [*self.data["audit"], _audit(record, actor_id, event)],
            }
            self._reserve(proposed)
            self.data.update(proposed)
            return deepcopy(record)

    def rate_limit(self, owner: str, action: str, limit: int = 30, seconds: int = 3600) -> None:
        current = int(time.time())
        window = current // seconds
        key = f"{owner}:{action}:{window}"
        with self.lock:
            rates = {key: value for key, value in self.data["rates"].items() if value[1] >= current}
            count = rates.get(key, (0, current + seconds))[0] + 1
            rates[key] = (count, (window + 1) * seconds)
            self.data["rates"] = rates
            if count > limit:
                raise WorkspaceError(
                    "rate_limit",
                    "The request limit for this time window has been reached. Try again later.",
                )

    def import_articles(self, owner: str, articles: list[dict]) -> int:
        with self.lock:
            corpus = {**self.data["corpus"]}
            for article in articles:
                corpus[f"{owner}\x1f{article['articleId']}"] = {
                    "owner": owner,
                    "article": deepcopy(article),
                }
            owned = [entry for entry in corpus.values() if entry["owner"] == owner]
            if len(owned) > 5000 or len(encode(owned).encode("utf-8")) > 20_000_000:
                raise WorkspaceError(
                    "session_corpus_limit",
                    "Temporary storage supports at most 5,000 articles and 20 MB. Use authenticated PostgreSQL storage for the full archive.",
                )
            proposed = {**self.data, "corpus": corpus}
            self._reserve(proposed)
            self.data.update(proposed)
            return len(articles)

    def corpus_count(self, owner: str) -> int:
        with self.lock:
            return sum(entry["owner"] == owner for entry in self.data["corpus"].values())

    def corpus_candidates(self, owner: str, query: str) -> list[dict]:
        terms = set(re.findall(r"\w{3,}", query.casefold()))
        with self.lock:
            scored = []
            for entry in self.data["corpus"].values():
                if entry["owner"] != owner:
                    continue
                article = entry["article"]
                text = " ".join(
                    str(article.get(k, "")) for k in ("title", "primaryClaim", "content")
                ).casefold()
                score = sum(text.count(term) for term in terms)
                if score:
                    scored.append((score, article))
            return [
                deepcopy(article)
                for _, article in sorted(scored, key=lambda entry: entry[0], reverse=True)[:500]
            ]

    def audit_for(self, owner: str, case_id: str) -> list[dict]:
        self.get(owner, case_id)
        with self.lock:
            return deepcopy(
                [
                    item
                    for item in self.data["audit"]
                    if item["ownerId"] == owner and item["caseId"] == case_id
                ]
            )


def _sql_schema():
    """Load SQLAlchemy only when durable storage is explicitly requested."""
    try:
        import sqlalchemy as sa
    except ImportError as exc:
        raise WorkspaceError(
            "storage_dependency",
            "Install the declared SQLAlchemy and psycopg dependencies for PostgreSQL storage.",
        ) from exc
    metadata = sa.MetaData()
    cases = sa.Table(
        "ccs_cases",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("owner_id", sa.String(320), nullable=False),
        sa.Column("request_id", sa.String(100), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload", sa.Text, nullable=False),
        sa.Column("summary", sa.Text, nullable=False),
        sa.Column("review_requested", sa.Boolean, nullable=False, default=False),
        sa.Column("review_status", sa.String(20), nullable=False, default="none"),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("owner_id", "request_id", name="ccs_owner_request"),
    )
    sa.Index("ccs_cases_owner_updated", cases.c.owner_id, cases.c.updated_at)
    sa.Index(
        "ccs_cases_review_queue",
        cases.c.review_requested,
        cases.c.review_status,
        cases.c.updated_at,
    )
    audits = sa.Table(
        "ccs_audit",
        metadata,
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("case_id", sa.String(64), nullable=False),
        sa.Column("owner_id", sa.String(320), nullable=False),
        sa.Column("actor_id", sa.String(320), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("event", sa.Text, nullable=False),
        sa.Column("snapshot", sa.Text, nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
    )
    sa.Index("ccs_audit_case_version", audits.c.case_id, audits.c.version)
    corpus = sa.Table(
        "ccs_corpus",
        metadata,
        sa.Column("owner_id", sa.String(320), primary_key=True),
        sa.Column("article_id", sa.String(200), primary_key=True),
        sa.Column("payload", sa.Text, nullable=False),
        sa.Column("search_text", sa.Text, nullable=False),
    )
    rates = sa.Table(
        "ccs_rate_limits",
        metadata,
        sa.Column("key", sa.String(500), primary_key=True),
        sa.Column("count", sa.Integer, nullable=False),
        sa.Column("expires_at", sa.Integer, nullable=False),
    )
    revision = sa.Table(
        "ccs_schema_revision", metadata, sa.Column("version", sa.Integer, primary_key=True)
    )
    return sa, metadata, cases, audits, corpus, rates, revision


def _database_url(url: str, allow_sqlite: bool = False) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgresql+psycopg://"):
        return url
    if allow_sqlite and url.startswith("sqlite"):
        return url
    raise WorkspaceError(
        "storage_configuration",
        "DATABASE_URL must be a PostgreSQL connection URL. SQLite is reserved for isolated tests.",
    )


class SqlRepository:
    """Transactional PostgreSQL storage; authorization stays in Workspace methods."""

    durable = True

    def __init__(self, url: str, *, allow_sqlite: bool = False, initialise: bool = False):
        self.sa, self.metadata, self.cases, self.audits, self.corpus, self.rates, self.revision = (
            _sql_schema()
        )
        safe_url = _database_url(url, allow_sqlite)
        options = {"pool_pre_ping": True}
        if safe_url.startswith("sqlite"):
            from sqlalchemy.pool import StaticPool

            options.update(poolclass=StaticPool, connect_args={"check_same_thread": False})
        try:
            self.engine = self.sa.create_engine(safe_url, **options)
            if initialise:
                self.initialise()
        except WorkspaceError:
            raise
        except Exception as exc:
            raise WorkspaceError(
                "storage_configuration",
                "The database connection or schema could not be configured. Check the administrator setup.",
            ) from exc
        try:
            with self.engine.connect() as connection:
                revision = (
                    connection.execute(self.sa.select(self.revision.c.version)).scalars().all()
                )
                if revision != [1]:
                    raise WorkspaceError(
                        "schema_required",
                        "Initialize the database with the documented schema command before starting the app.",
                    )
        except WorkspaceError:
            raise
        except Exception as exc:
            raise WorkspaceError(
                "storage_unavailable",
                "The database is unavailable or its schema is not initialized. Check the deployment configuration.",
            ) from exc

    def initialise(self) -> None:
        """Explicit administration-only bootstrap; never called by Workspace automatically."""
        self.metadata.create_all(self.engine)
        with self.engine.begin() as connection:
            if not connection.execute(self.sa.select(self.revision.c.version)).first():
                connection.execute(self.revision.insert().values(version=1))
            if self.engine.dialect.name == "postgresql":
                connection.execute(
                    self.sa.text(
                        "CREATE INDEX IF NOT EXISTS ccs_corpus_fts ON ccs_corpus USING GIN (to_tsvector('simple', search_text))"
                    )
                )

    @contextmanager
    def transaction(self):
        try:
            with self.engine.begin() as connection:
                yield connection
        except WorkspaceError:
            raise
        except Exception as exc:
            raise WorkspaceError(
                "storage_unavailable",
                "The database could not complete this operation. No partial update was intentionally applied.",
            ) from exc

    def _decode(self, row) -> dict | None:
        return json.loads(row[0]) if row else None

    def get(self, owner: str, case_id: str, shared: bool = False) -> dict:
        condition = self.cases.c.owner_id == owner
        if shared:
            condition = self.sa.or_(condition, self.cases.c.review_requested.is_(True))
        with self.transaction() as connection:
            record = self._decode(
                connection.execute(
                    self.sa.select(self.cases.c.payload).where(
                        self.cases.c.id == case_id, condition
                    )
                ).first()
            )
        if not record:
            raise WorkspaceError(
                "case_not_found", "This case was not found or has not been shared with you."
            )
        return record

    def find_request(self, owner: str, request_id: str) -> dict | None:
        with self.transaction() as connection:
            return self._decode(
                connection.execute(
                    self.sa.select(self.cases.c.payload).where(
                        self.cases.c.owner_id == owner, self.cases.c.request_id == request_id
                    )
                ).first()
            )

    def list_cases(self, owner: str) -> list[dict]:
        with self.transaction() as connection:
            rows = connection.execute(
                self.sa.select(self.cases.c.summary)
                .where(self.cases.c.owner_id == owner)
                .order_by(self.cases.c.updated_at.desc())
                .limit(100)
            ).all()
        return [json.loads(row[0]) for row in rows]

    def list_reviews(self) -> list[dict]:
        with self.transaction() as connection:
            rows = connection.execute(
                self.sa.select(self.cases.c.summary)
                .where(
                    self.cases.c.review_requested.is_(True), self.cases.c.review_status == "pending"
                )
                .order_by(self.cases.c.updated_at.desc())
                .limit(100)
            ).all()
        return [json.loads(row[0]) for row in rows]

    def _insert(self, table):
        if self.engine.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        return insert(table)

    def _audit_insert(self, connection, record: dict, actor: str, event: dict) -> None:
        connection.execute(
            self.audits.insert().values(
                id=str(uuid4()),
                case_id=record["id"],
                owner_id=record["ownerId"],
                actor_id=actor,
                version=record["version"],
                event=encode(event),
                snapshot=checked_case(record),
                created_at=record["updatedAt"],
            )
        )

    def create(self, record: dict, actor_id: str) -> tuple[dict, bool]:
        payload = checked_case(record)
        with self.transaction() as connection:
            statement = self._insert(self.cases).values(
                id=record["id"],
                owner_id=record["ownerId"],
                request_id=record["requestId"],
                version=record["version"],
                payload=payload,
                summary=encode(_summary(record)),
                review_requested=record.get("reviewRequested", False),
                review_status=record.get("reviewStatus", "none"),
                updated_at=record["updatedAt"],
            )
            # INSERT rowcount is not portable across psycopg/SQLAlchemy result
            # handling. RETURNING distinguishes a new row from a conflict
            # directly, including an idempotent request arriving concurrently.
            inserted_id = connection.execute(
                statement.on_conflict_do_nothing(
                    index_elements=["owner_id", "request_id"]
                ).returning(self.cases.c.id)
            ).scalar_one_or_none()
            stored = self._decode(
                connection.execute(
                    self.sa.select(self.cases.c.payload).where(
                        self.cases.c.owner_id == record["ownerId"],
                        self.cases.c.request_id == record["requestId"],
                    )
                ).first()
            )
            if stored["requestHash"] != record["requestHash"]:
                raise WorkspaceError(
                    "idempotency_conflict",
                    "This request identifier was already used for different content.",
                )
            created = inserted_id is not None
            if created:
                self._audit_insert(connection, record, actor_id, record["events"][0])
        return stored, created

    def save(self, previous: dict, record: dict, actor_id: str, event: dict) -> dict:
        payload = checked_case(record)
        with self.transaction() as connection:
            updated_id = connection.execute(
                self.cases.update()
                .where(
                    self.cases.c.id == previous["id"],
                    self.cases.c.owner_id == previous["ownerId"],
                    self.cases.c.version == previous["version"],
                )
                .values(
                    payload=payload,
                    summary=encode(_summary(record)),
                    version=record["version"],
                    updated_at=record["updatedAt"],
                    review_requested=record.get("reviewRequested", False),
                    review_status=record.get("reviewStatus", "none"),
                )
                .returning(self.cases.c.id)
            ).scalar_one_or_none()
            if updated_id is None:
                raise WorkspaceError(
                    "version_conflict",
                    "This case changed. Refresh it before submitting your decision.",
                )
            self._audit_insert(connection, record, actor_id, event)
        return deepcopy(record)

    def rate_limit(self, owner: str, action: str, limit: int = 30, seconds: int = 3600) -> None:
        current = int(time.time())
        window = current // seconds
        with self.transaction() as connection:
            statement = self._insert(self.rates).values(
                key=f"{owner}:{action}:{window}", count=1, expires_at=(window + 1) * seconds
            )
            count = connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["key"], set_={"count": self.rates.c.count + 1}
                ).returning(self.rates.c.count)
            ).scalar_one()
            connection.execute(self.rates.delete().where(self.rates.c.expires_at < current - 86400))
        if count > limit:
            raise WorkspaceError(
                "rate_limit",
                "The request limit for this time window has been reached. Try again later.",
            )

    def import_articles(self, owner: str, articles: list[dict]) -> int:
        with self.transaction() as connection:
            for article in articles:
                statement = self._insert(self.corpus).values(
                    owner_id=owner,
                    article_id=article["articleId"],
                    payload=encode(article),
                    search_text=" ".join(
                        str(article.get(k, "")) for k in ("title", "primaryClaim", "content")
                    ).casefold(),
                )
                connection.execute(
                    statement.on_conflict_do_update(
                        index_elements=["owner_id", "article_id"],
                        set_={
                            "payload": statement.excluded.payload,
                            "search_text": statement.excluded.search_text,
                        },
                    )
                )
        return len(articles)

    def corpus_count(self, owner: str) -> int:
        with self.transaction() as connection:
            return connection.execute(
                self.sa.select(self.sa.func.count())
                .select_from(self.corpus)
                .where(self.corpus.c.owner_id == owner)
            ).scalar_one()

    def corpus_candidates(self, owner: str, query: str) -> list[dict]:
        terms = list(dict.fromkeys(re.findall(r"\w{3,}", query.casefold())))[:8]
        if not terms:
            return []
        with self.transaction() as connection:
            if self.engine.dialect.name == "postgresql":
                rows = connection.execute(
                    self.sa.text(
                        "SELECT payload FROM ccs_corpus WHERE owner_id = :owner AND to_tsvector('simple', search_text) @@ websearch_to_tsquery('simple', :query) ORDER BY ts_rank_cd(to_tsvector('simple', search_text), websearch_to_tsquery('simple', :query)) DESC LIMIT 500"
                    ),
                    {"owner": owner, "query": " OR ".join(terms)},
                ).all()
            else:
                rows = connection.execute(
                    self.sa.select(self.corpus.c.payload)
                    .where(
                        self.corpus.c.owner_id == owner,
                        self.sa.or_(
                            *[
                                self.corpus.c.search_text.contains(term, autoescape=True)
                                for term in terms
                            ]
                        ),
                    )
                    .limit(500)
                ).all()
        return [json.loads(row[0]) for row in rows]

    def audit_for(self, owner: str, case_id: str) -> list[dict]:
        self.get(owner, case_id)
        with self.transaction() as connection:
            rows = (
                connection.execute(
                    self.sa.select(self.audits)
                    .where(self.audits.c.owner_id == owner, self.audits.c.case_id == case_id)
                    .order_by(self.audits.c.version)
                )
                .mappings()
                .all()
            )
        return [
            {
                **dict(row),
                "event": json.loads(row["event"]),
                "snapshot": json.loads(row["snapshot"]),
            }
            for row in rows
        ]


def initialise_database(url: str) -> None:
    """Run only from a trusted administrator process with DATABASE_URL configured."""
    SqlRepository(url, initialise=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Initialize the Evidence AI PostgreSQL schema.")
    parser.add_argument("action", choices=["init"])
    parser.parse_args()
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        import tomllib
        from pathlib import Path

        secrets_path = Path(".streamlit/secrets.toml")
        if secrets_path.is_file():
            try:
                url = tomllib.loads(secrets_path.read_text(encoding="utf-8")).get(
                    "DATABASE_URL", ""
                )
            except (OSError, tomllib.TOMLDecodeError):
                raise SystemExit(
                    "The local secrets file could not be read. Check its TOML syntax."
                ) from None
    if not url:
        raise SystemExit(
            "Set DATABASE_URL in the administrator's environment; never pass credentials as CLI arguments."
        )
    try:
        initialise_database(url)
    except WorkspaceError as error:
        raise SystemExit(str(error)) from None
    print("Evidence AI schema initialized (revision 1).")
