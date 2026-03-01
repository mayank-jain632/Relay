export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface TaskCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface Task {
  id: string;
  assignee_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority?: string;
  dueDate?: string | null;
  orderIndex: number;
  source?: string;
  sourceUrl?: string | null;
  linkedFiles: string[];
  branchName?: string | null;
  commits?: TaskCommit[];
  ai_title?: string | null;
  ai_summary?: string | null;
  ai_acceptance_criteria?: string[];
  ai_open_questions?: string[];
  ai_tags?: string[];
  timestamp: string;
  updatedAt?: string;
}

export interface UserMapping {
  [slackId: string]: string;
}

export interface TaskListResponse {
  tasks: Task[];
}

export interface TaskDetailResponse {
  task: Task;
}
