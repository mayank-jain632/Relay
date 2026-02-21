export type TaskStatus = 'pending' | 'completed';

export interface Task {
  id: string;
  assignee_id: string;
  filePath: string;
  description: string;
  orderIndex: number;
  status: TaskStatus;
  timestamp: string;
}

export interface UserMapping {
  [slackId: string]: string;
}

export interface TaskListResponse {
  tasks: Task[];
}
