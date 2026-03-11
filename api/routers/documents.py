"""Document endpoints for the Control Center API."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, status

from database import get_db
from models import DocumentCreate, DocumentResponse

router = APIRouter()

UPLOAD_DIR: Path = Path(__file__).parent.parent.parent / "store" / "uploads"


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


@router.get("/documents", response_model=list[DocumentResponse])
def list_documents(
    project_id: str = Query(...),
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List documents for a project, ordered by creation date descending."""
    rows = db.execute(
        "SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post(
    "/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_document(
    body: DocumentCreate, db: sqlite3.Connection = Depends(get_db)
) -> dict:
    """Create a new document record (name + url)."""
    now = int(time.time())
    doc_id = str(uuid4())

    db.execute(
        """
        INSERT INTO documents (id, project_id, name, url, file_path, created_at)
        VALUES (?, ?, ?, ?, '', ?)
        """,
        (doc_id, body.project_id, body.name, body.url, now),
    )
    db.commit()

    result = db.execute(
        "SELECT * FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    return _row_to_dict(result)


@router.post(
    "/documents/upload",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_document(
    project_id: str = Query(...),
    file: UploadFile = ...,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Upload a file and create a document record for it."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    now = int(time.time())
    doc_id = str(uuid4())
    ext = Path(file.filename).suffix if file.filename else ""
    stored_name = f"{uuid4()}{ext}"
    dest = UPLOAD_DIR / stored_name

    content = file.file.read()
    dest.write_bytes(content)

    relative_path = f"store/uploads/{stored_name}"

    db.execute(
        """
        INSERT INTO documents (id, project_id, name, url, file_path, created_at)
        VALUES (?, ?, ?, '', ?, ?)
        """,
        (doc_id, project_id, file.filename or stored_name, relative_path, now),
    )
    db.commit()

    result = db.execute(
        "SELECT * FROM documents WHERE id = ?", (doc_id,)
    ).fetchone()
    return _row_to_dict(result)


@router.delete(
    "/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_document(
    document_id: str, db: sqlite3.Connection = Depends(get_db)
) -> Response:
    """Delete a document by ID."""
    existing = db.execute(
        "SELECT * FROM documents WHERE id = ?", (document_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    # Remove uploaded file if it exists
    file_path = existing["file_path"]
    if file_path:
        full_path = Path(__file__).parent.parent.parent / file_path
        if full_path.exists():
            full_path.unlink()

    db.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
