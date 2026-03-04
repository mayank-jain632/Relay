export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'review' | 'done';

export interface TaskCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface RelayUser {
  userId: string;
  githubId?: string;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  sessionToken?: string;
}

export interface Task {
  id: string;
  projectId?: string;
  assignee_id: string | null;
  assignedToUserId?: string | null;
  pendingSlackAssignee?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  updatedBy?: RelayUser | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: string;
  dueDate?: string | null;
  orderIndex: number;
  source?: string;
  sourceUrl?: string | null;
  slackUserId?: string | null;
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  slackWorkspaceId?: string | null;
  linkedFiles: string[];
  branchName?: string | null;
  prUrl?: string | null;
  autoCloseOnMerge?: boolean;
  commits?: TaskCommit[];
  ai_title?: string | null;
  ai_summary?: string | null;
  ai_acceptance_criteria?: string[];
  ai_open_questions?: string[];
  ai_tags?: string[];
  timestamp: string;
  updatedAt?: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role?: string;
  createdAt?: string;
}

export interface UserMapping {
  [slackId: string]: string;
}

export interface TaskListResponse {
  tasks: Task[];
}

export interface TaskDetailResponse {
  task: Task;
  warning?: string;
}
