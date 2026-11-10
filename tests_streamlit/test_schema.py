"""Keep managed-database bootstrap reproducible and validate real PostgreSQL use."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from evidence_streamlit.storage import SqlRepository
from evidence_streamlit.workspace import Workspace
from scripts.generate_streamlit_schema import TARGET, render_schema


class SchemaArtifactTests(unittest.TestCase):
    def test_committed_sql_matches_current_runtime_metadata(self):
        self.assertEqual(TARGET.read_text(encoding="utf-8"), render_schema())


@unittest.skipUnless(
    os.environ.get("TEST_DATABASE_URL"),
    "Set TEST_DATABASE_URL to an isolated PostgreSQL test service.",
)
class PostgreSQLBootstrapTests(unittest.TestCase):
    def test_sql_console_bootstrap_is_repeatable_and_usable_by_normal_runtime(self):
        import sqlalchemy as sa

        # Only the explicit disposable test DSN is read. Random schema names
        # isolate this bootstrap from the workflow tests and any existing data.
        url = sa.engine.make_url(os.environ["TEST_DATABASE_URL"])
        if url.drivername in {"postgres", "postgresql"}:
            url = url.set(drivername="postgresql+psycopg")
        self.assertEqual(url.drivername, "postgresql+psycopg")
        schema = "ccs_bootstrap_test_" + uuid4().hex
        administrator = sa.create_engine(url)
        self.addCleanup(administrator.dispose)
        with administrator.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            connection.exec_driver_sql(f'SET search_path TO "{schema}"')
            connection.exec_driver_sql(TARGET.read_text(encoding="utf-8"))
            connection.exec_driver_sql(TARGET.read_text(encoding="utf-8"))
            self.assertEqual(
                connection.exec_driver_sql("SELECT version FROM ccs_schema_revision")
                .scalars()
                .all(),
                [1],
            )
            indexes = set(
                connection.execute(
                    sa.text("SELECT indexname FROM pg_indexes WHERE schemaname = :schema"),
                    {"schema": schema},
                ).scalars()
            )
            self.assertTrue(
                {
                    "ccs_corpus_fts",
                    "ccs_cases_owner_updated",
                    "ccs_cases_review_queue",
                    "ccs_audit_case_version",
                }
                <= indexes
            )
        options = (url.query.get("options", "") + " -csearch_path=" + schema).strip()
        scoped_url = url.update_query_dict({"options": options})
        repository = SqlRepository(scoped_url.render_as_string(hide_password=False))
        self.addCleanup(repository.engine.dispose)
        user = {
            "id": "bootstrap-test:" + uuid4().hex,
            "authenticated": True,
            "authorized": True,
            "can_review": False,
            "can_investigate": True,
        }
        with patch("evidence_streamlit.workspace.SqlRepository", return_value=repository):
            workspace = Workspace({}, {"DATABASE_URL": "postgresql://test-only/bootstrap"}, user)
        case = workspace.create_case("The library has extended its opening hours this week.")
        self.assertEqual(workspace.get_case(case["id"])["id"], case["id"])
        audit = workspace.export_case(case["id"])["audit"]
        self.assertEqual([entry["version"] for entry in audit], [1])
        self.assertEqual(audit[0]["event"]["type"], "case_created")
        with repository.engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as connection:
            connection.exec_driver_sql("UPDATE ccs_schema_revision SET version = 2")
            with self.assertRaises(sa.exc.DBAPIError):
                connection.exec_driver_sql(TARGET.read_text(encoding="utf-8"))
            connection.exec_driver_sql("ROLLBACK")
            self.assertEqual(
                connection.exec_driver_sql("SELECT version FROM ccs_schema_revision")
                .scalars()
                .all(),
                [2],
            )
            self.assertEqual(
                connection.exec_driver_sql("SELECT count(*) FROM ccs_cases").scalar_one(), 1
            )


if __name__ == "__main__":
    unittest.main()
