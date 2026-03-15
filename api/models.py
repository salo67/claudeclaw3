"""Pydantic models for the ClaudeClaw Control Center API."""
from __future__ import annotations
from pydantic import BaseModel

# --- Projects ---
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    phase: str = "backlog"
    priority: str = "none"
    tags: str = ""
    color: str = "#f59e0b"
    autopilot: bool = False
    paused: bool = False

class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    phase: str | None = None
    completed: bool | None = None
    autopilot: bool | None = None
    paused: bool | None = None
    priority: str | None = None
    tags: str | None = None
    color: str | None = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str
    phase: str
    completed: bool
    autopilot: bool
    paused: bool
    priority: str
    tags: str
    color: str
    created_at: int
    updated_at: int

class ProjectDetailResponse(ProjectResponse):
    features: list[FeatureResponse] = []
    tasks: list[TaskResponse] = []
    documents: list[DocumentResponse] = []

# --- Features ---
class FeatureCreate(BaseModel):
    project_id: str
    description: str
    objective: str = ""
    acceptance_criteria: str = ""
    phase: str = "backlog"
    autopilot: bool = False
    priority: str = "none"
    wave: int = 0

class FeatureUpdate(BaseModel):
    description: str | None = None
    objective: str | None = None
    acceptance_criteria: str | None = None
    phase: str | None = None
    autopilot: bool | None = None
    priority: str | None = None
    completed: bool | None = None
    wave: int | None = None

class FeatureResponse(BaseModel):
    id: str
    project_id: str
    description: str
    objective: str
    acceptance_criteria: str
    phase: str
    autopilot: bool
    priority: str
    completed: bool
    position: float
    wave: int
    created_at: int
    updated_at: int

class FeatureDetailResponse(FeatureResponse):
    tasks: list[TaskResponse] = []

# --- Tasks ---
class TaskCreate(BaseModel):
    description: str
    project_id: str | None = None
    feature_id: str | None = None
    acceptance_criteria: str = ""

class TaskUpdate(BaseModel):
    description: str | None = None
    completed: bool | None = None
    position: float | None = None
    project_id: str | None = None
    feature_id: str | None = None
    acceptance_criteria: str | None = None
    verification_status: str | None = None
    verification_output: str | None = None

class TaskResponse(BaseModel):
    id: str
    project_id: str | None
    feature_id: str | None
    description: str
    acceptance_criteria: str
    completed: bool
    verification_status: str
    verification_output: str
    position: float
    created_at: int
    updated_at: int

# --- Documents ---
class DocumentCreate(BaseModel):
    project_id: str
    name: str
    url: str = ""

class DocumentResponse(BaseModel):
    id: str
    project_id: str
    name: str
    url: str
    file_path: str
    created_at: int

# --- Notes ---
class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: str = ""
    project_id: str | None = None
    pinned: bool = False
    linked_task_ids: str = ""

class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: str | None = None
    project_id: str | None = None
    pinned: bool | None = None
    linked_task_ids: str | None = None

class NoteResponse(BaseModel):
    id: str
    title: str
    content: str
    tags: str
    project_id: str | None
    pinned: bool
    linked_task_ids: str = ""
    created_at: int
    updated_at: int

# --- Journal ---
class JournalCreate(BaseModel):
    date: str | None = None
    content: str = ""
    mood: str = ""
    tags: str = ""
    linked_task_ids: str = ""

class JournalUpdate(BaseModel):
    content: str | None = None
    mood: str | None = None
    tags: str | None = None
    linked_task_ids: str | None = None

class JournalResponse(BaseModel):
    id: str
    date: str
    content: str
    mood: str
    tags: str
    bot_prompts: str
    linked_task_ids: str = ""
    created_at: int
    updated_at: int

# --- Alerts ---
class AlertCreate(BaseModel):
    category: str = "info"
    severity: str = "info"
    title: str
    description: str = ""
    action: str = ""
    source: str = ""

class AlertResponse(BaseModel):
    id: str
    category: str
    severity: str
    title: str
    description: str
    action: str
    source: str
    dismissed: bool
    executed: bool
    created_at: int

# --- Action Items ---
class ActionItemCreate(BaseModel):
    advisor_key: str = ""
    finding_id: str = ""
    title: str
    detail: str = ""
    estimated_impact: str = ""
    category: str = "general"
    priority: str = "normal"

class ActionItemUpdate(BaseModel):
    title: str | None = None
    detail: str | None = None
    estimated_impact: str | None = None
    category: str | None = None
    priority: str | None = None
    status: str | None = None

class ActionItemCommentCreate(BaseModel):
    author: str
    content: str

class ActionItemCommentResponse(BaseModel):
    id: str
    action_item_id: str
    author: str
    content: str
    created_at: int

class ActionItemResponse(BaseModel):
    id: str
    advisor_key: str
    finding_id: str
    title: str
    detail: str
    estimated_impact: str
    category: str
    priority: str
    status: str
    approved_at: int | None = None
    rejected_at: int | None = None
    completed_at: int | None = None
    created_at: int
    updated_at: int
    comment_count: int = 0
    comments: list[ActionItemCommentResponse] = []

# --- Pulse Modules ---
class PulseModuleCreate(BaseModel):
    key: str
    name: str
    description: str = ""
    category: str = "business"
    enabled: bool = True
    config: str = "{}"
    icon: str = "chart"

class PulseModuleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    enabled: bool | None = None
    config: str | None = None
    icon: str | None = None
    position: int | None = None

class PulseModuleResponse(BaseModel):
    id: str
    key: str
    name: str
    description: str
    category: str
    enabled: bool
    config: str
    icon: str
    position: int
    created_at: int
    updated_at: int

# --- Daily Pulses ---
class DailyPulseResponse(BaseModel):
    id: str
    date: str
    snapshot: dict
    generated_at: str
    created_at: int

class DailyPulseListResponse(BaseModel):
    items: list[DailyPulseResponse]
    total: int
    page: int
    page_size: int

# Rebuild forward refs
ProjectDetailResponse.model_rebuild()
FeatureDetailResponse.model_rebuild()
