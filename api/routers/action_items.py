"""Action Items -- advisor-proposed business decisions with conversational review flow."""

from __future__ import annotations

import sqlite3
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from database import get_db
from models import ActionItemCreate, ActionItemUpdate, ActionItemResponse, ActionItemCommentCreate, ActionItemCommentResponse

router = APIRouter()


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


@router.get("/action-items", response_model=list[ActionItemResponse])
def list_action_items(
    status_filter: str | None = Query(None, alias="status"),
    advisor: str | None = None,
    priority: str | None = None,
    limit: int = 50,
    db: sqlite3.Connection = Depends(get_db),
) -> list[dict]:
    """List action items, newest first. Filter by status, advisor, priority."""
    conditions: list[str] = []
    params: list = []

    if status_filter:
        conditions.append("status = ?")
        params.append(status_filter)

    if advisor:
        conditions.append("advisor_key = ?")
        params.append(advisor)

    if priority:
        conditions.append("priority = ?")
        params.append(priority)

    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)
    rows = db.execute(
        f"SELECT * FROM action_items{where} ORDER BY created_at DESC LIMIT ?",  # noqa: S608
        params,
    ).fetchall()
    items = []
    for r in rows:
        d = _row_to_dict(r)
        # Attach comment count
        count = db.execute(
            "SELECT COUNT(*) FROM action_item_comments WHERE action_item_id = ?",
            (d["id"],),
        ).fetchone()[0]
        d["comment_count"] = count
        items.append(d)
    return items


@router.get("/action-items/summary")
def action_items_summary(db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Counts by status for dashboard widgets."""
    rows = db.execute(
        "SELECT status, COUNT(*) as count FROM action_items GROUP BY status"
    ).fetchall()
    counts = {r["status"]: r["count"] for r in rows}
    return {
        "proposed": counts.get("proposed", 0),
        "in_review": counts.get("in_review", 0),
        "approved": counts.get("approved", 0),
        "rejected": counts.get("rejected", 0),
        "done": counts.get("done", 0),
        "total_pending": counts.get("proposed", 0) + counts.get("in_review", 0),
    }


@router.get("/action-items/{item_id}", response_model=ActionItemResponse)
def get_action_item(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Get a single action item with its comments."""
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Action item not found")
    d = _row_to_dict(row)
    # Attach comments
    comments = db.execute(
        "SELECT * FROM action_item_comments WHERE action_item_id = ? ORDER BY created_at ASC",
        (item_id,),
    ).fetchall()
    d["comments"] = [_row_to_dict(c) for c in comments]
    d["comment_count"] = len(d["comments"])
    return d


@router.post("/action-items", response_model=ActionItemResponse, status_code=status.HTTP_201_CREATED)
def create_action_item(body: ActionItemCreate, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Create a new action item (typically by an advisor during discovery)."""
    now = int(time.time())
    item_id = str(uuid4())
    db.execute(
        """INSERT INTO action_items
           (id, advisor_key, finding_id, title, detail, estimated_impact,
            category, priority, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)""",
        (
            item_id, body.advisor_key, body.finding_id, body.title,
            body.detail, body.estimated_impact, body.category, body.priority,
            now, now,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    d = _row_to_dict(row)
    d["comments"] = []
    d["comment_count"] = 0
    return d


@router.patch("/action-items/{item_id}", response_model=ActionItemResponse)
def update_action_item(
    item_id: str,
    body: ActionItemUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Update an action item (status change, detail refinement, etc)."""
    existing = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action item not found")

    now = int(time.time())
    updates = []
    params = []

    for field in ("title", "detail", "estimated_impact", "category", "priority", "status"):
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field} = ?")
            params.append(val)

    # Track approval/rejection timestamps
    if body.status == "approved":
        updates.append("approved_at = ?")
        params.append(now)
    elif body.status == "rejected":
        updates.append("rejected_at = ?")
        params.append(now)
    elif body.status == "done":
        updates.append("completed_at = ?")
        params.append(now)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = ?")
    params.append(now)
    params.append(item_id)

    db.execute(
        f"UPDATE action_items SET {', '.join(updates)} WHERE id = ?",  # noqa: S608
        params,
    )
    db.commit()
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    d = _row_to_dict(row)
    d["comment_count"] = db.execute(
        "SELECT COUNT(*) FROM action_item_comments WHERE action_item_id = ?", (item_id,)
    ).fetchone()[0]
    return d


# ── Comments (the conversational thread) ──────────────────────────


@router.post("/action-items/{item_id}/comments", response_model=ActionItemCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(
    item_id: str,
    body: ActionItemCommentCreate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Add a comment to an action item (CEO feedback or advisor response)."""
    existing = db.execute("SELECT id FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action item not found")

    now = int(time.time())
    comment_id = str(uuid4())
    db.execute(
        """INSERT INTO action_item_comments
           (id, action_item_id, author, content, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (comment_id, item_id, body.author, body.content, now),
    )
    # Move to in_review if it was proposed and CEO comments
    if body.author == "ceo":
        db.execute(
            "UPDATE action_items SET status = 'in_review', updated_at = ? WHERE id = ? AND status = 'proposed'",
            (now, item_id),
        )
    db.commit()
    row = db.execute("SELECT * FROM action_item_comments WHERE id = ?", (comment_id,)).fetchone()
    return _row_to_dict(row)


@router.get("/action-items/{item_id}/comments", response_model=list[ActionItemCommentResponse])
def list_comments(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> list[dict]:
    """List all comments on an action item, oldest first."""
    rows = db.execute(
        "SELECT * FROM action_item_comments WHERE action_item_id = ? ORDER BY created_at ASC",
        (item_id,),
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


# ── Quick actions ─────────────────────────────────────────────────


@router.patch("/action-items/{item_id}/approve", response_model=ActionItemResponse)
def approve_action_item(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Quick-approve an action item."""
    existing = db.execute("SELECT id FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action item not found")
    now = int(time.time())
    db.execute(
        "UPDATE action_items SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?",
        (now, now, item_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    d = _row_to_dict(row)
    d["comment_count"] = db.execute(
        "SELECT COUNT(*) FROM action_item_comments WHERE action_item_id = ?", (item_id,)
    ).fetchone()[0]
    return d


@router.patch("/action-items/{item_id}/reject", response_model=ActionItemResponse)
def reject_action_item(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Quick-reject an action item."""
    existing = db.execute("SELECT id FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action item not found")
    now = int(time.time())
    db.execute(
        "UPDATE action_items SET status = 'rejected', rejected_at = ?, updated_at = ? WHERE id = ?",
        (now, now, item_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    d = _row_to_dict(row)
    d["comment_count"] = db.execute(
        "SELECT COUNT(*) FROM action_item_comments WHERE action_item_id = ?", (item_id,)
    ).fetchone()[0]
    return d


@router.patch("/action-items/{item_id}/done", response_model=ActionItemResponse)
def mark_done(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Mark an approved action item as completed."""
    existing = db.execute("SELECT id FROM action_items WHERE id = ?", (item_id,)).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Action item not found")
    now = int(time.time())
    db.execute(
        "UPDATE action_items SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
        (now, now, item_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM action_items WHERE id = ?", (item_id,)).fetchone()
    d = _row_to_dict(row)
    d["comment_count"] = db.execute(
        "SELECT COUNT(*) FROM action_item_comments WHERE action_item_id = ?", (item_id,)
    ).fetchone()[0]
    return d


@router.delete("/action-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action_item(item_id: str, db: sqlite3.Connection = Depends(get_db)) -> Response:
    """Delete an action item and its comments."""
    db.execute("DELETE FROM action_item_comments WHERE action_item_id = ?", (item_id,))
    db.execute("DELETE FROM action_items WHERE id = ?", (item_id,))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


