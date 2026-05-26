import { TrelloClient } from './client';
import type {
  TrelloConfig,
  Member,
  Board,
  CreateBoardInput,
  List,
  CreateListInput,
  Card,
  CreateCardInput,
  Label,
  CreateLabelInput,
  Checklist,
  CheckItem,
  CreateChecklistInput,
  CreateCheckItemInput,
  Action,
  Attachment,
  Organization,
} from '../types';

export { TrelloClient } from './client';

export class Trello {
  private client: TrelloClient;

  constructor(config: TrelloConfig) {
    this.client = new TrelloClient(config);
  }

  // ============================================
  // Members
  // ============================================

  async getMe(): Promise<Member> {
    return this.client.get<Member>('/members/me');
  }

  async getMember(idOrUsername: string): Promise<Member> {
    return this.client.get<Member>(`/members/${idOrUsername}`);
  }

  async getMemberBoards(idOrUsername: string): Promise<Board[]> {
    return this.client.get<Board[]>(`/members/${idOrUsername}/boards`);
  }

  async getMemberOrganizations(idOrUsername: string): Promise<Organization[]> {
    return this.client.get<Organization[]>(`/members/${idOrUsername}/organizations`);
  }

  // ============================================
  // Boards
  // ============================================

  async getBoard(id: string): Promise<Board> {
    return this.client.get<Board>(`/boards/${id}`);
  }

  async createBoard(input: CreateBoardInput): Promise<Board> {
    return this.client.post<Board>('/boards', undefined, input as unknown as Record<string, string>);
  }

  async updateBoard(id: string, input: Partial<CreateBoardInput>): Promise<Board> {
    return this.client.put<Board>(`/boards/${id}`, undefined, input as unknown as Record<string, string>);
  }

  async deleteBoard(id: string): Promise<void> {
    await this.client.delete(`/boards/${id}`);
  }

  async getBoardLists(boardId: string, filter: 'all' | 'open' | 'closed' = 'open'): Promise<List[]> {
    return this.client.get<List[]>(`/boards/${boardId}/lists`, { filter });
  }

  async getBoardCards(boardId: string, filter: 'all' | 'open' | 'closed' | 'visible' = 'open'): Promise<Card[]> {
    return this.client.get<Card[]>(`/boards/${boardId}/cards`, { filter });
  }

  async getBoardLabels(boardId: string): Promise<Label[]> {
    return this.client.get<Label[]>(`/boards/${boardId}/labels`);
  }

  async getBoardMembers(boardId: string): Promise<Member[]> {
    return this.client.get<Member[]>(`/boards/${boardId}/members`);
  }

  async addMemberToBoard(boardId: string, email: string, type: 'admin' | 'normal' | 'observer' = 'normal'): Promise<Member> {
    return this.client.put<Member>(`/boards/${boardId}/members`, undefined, { email, type });
  }

  async removeMemberFromBoard(boardId: string, memberId: string): Promise<void> {
    await this.client.delete(`/boards/${boardId}/members/${memberId}`);
  }

  // ============================================
  // Lists
  // ============================================

  async getList(id: string): Promise<List> {
    return this.client.get<List>(`/lists/${id}`);
  }

  async createList(input: CreateListInput): Promise<List> {
    return this.client.post<List>('/lists', undefined, input as unknown as Record<string, string>);
  }

  async updateList(id: string, input: Partial<{ name: string; closed: boolean; pos: 'top' | 'bottom' | number }>): Promise<List> {
    return this.client.put<List>(`/lists/${id}`, undefined, input as unknown as Record<string, string>);
  }

  async archiveList(id: string): Promise<List> {
    return this.client.put<List>(`/lists/${id}/closed`, undefined, { value: 'true' });
  }

  async getListCards(listId: string): Promise<Card[]> {
    return this.client.get<Card[]>(`/lists/${listId}/cards`);
  }

  // ============================================
  // Cards
  // ============================================

  async getCard(id: string): Promise<Card> {
    return this.client.get<Card>(`/cards/${id}`);
  }

  async createCard(input: CreateCardInput): Promise<Card> {
    return this.client.post<Card>('/cards', undefined, input as unknown as Record<string, string>);
  }

  async updateCard(id: string, input: Partial<CreateCardInput & { closed: boolean; idList: string }>): Promise<Card> {
    return this.client.put<Card>(`/cards/${id}`, undefined, input as unknown as Record<string, string>);
  }

  async deleteCard(id: string): Promise<void> {
    await this.client.delete(`/cards/${id}`);
  }

  async archiveCard(id: string): Promise<Card> {
    return this.client.put<Card>(`/cards/${id}`, undefined, { closed: 'true' });
  }

  async moveCard(id: string, idList: string, pos?: 'top' | 'bottom' | number): Promise<Card> {
    return this.client.put<Card>(`/cards/${id}`, undefined, {
      idList,
      pos: pos?.toString(),
    });
  }

  async addLabelToCard(cardId: string, labelId: string): Promise<void> {
    await this.client.post(`/cards/${cardId}/idLabels`, undefined, { value: labelId });
  }

  async removeLabelFromCard(cardId: string, labelId: string): Promise<void> {
    await this.client.delete(`/cards/${cardId}/idLabels/${labelId}`);
  }

  async addMemberToCard(cardId: string, memberId: string): Promise<void> {
    await this.client.post(`/cards/${cardId}/idMembers`, undefined, { value: memberId });
  }

  async removeMemberFromCard(cardId: string, memberId: string): Promise<void> {
    await this.client.delete(`/cards/${cardId}/idMembers/${memberId}`);
  }

  async getCardAttachments(cardId: string): Promise<Attachment[]> {
    return this.client.get<Attachment[]>(`/cards/${cardId}/attachments`);
  }

  async getCardActions(cardId: string, filter?: string): Promise<Action[]> {
    return this.client.get<Action[]>(`/cards/${cardId}/actions`, { filter });
  }

  // ============================================
  // Labels
  // ============================================

  async getLabel(id: string): Promise<Label> {
    return this.client.get<Label>(`/labels/${id}`);
  }

  async createLabel(input: CreateLabelInput): Promise<Label> {
    return this.client.post<Label>('/labels', undefined, input as unknown as Record<string, string>);
  }

  async updateLabel(id: string, input: Partial<{ name: string; color: string }>): Promise<Label> {
    return this.client.put<Label>(`/labels/${id}`, undefined, input as unknown as Record<string, string>);
  }

  async deleteLabel(id: string): Promise<void> {
    await this.client.delete(`/labels/${id}`);
  }

  // ============================================
  // Checklists
  // ============================================

  async getChecklist(id: string): Promise<Checklist> {
    return this.client.get<Checklist>(`/checklists/${id}`);
  }

  async createChecklist(input: CreateChecklistInput): Promise<Checklist> {
    return this.client.post<Checklist>('/checklists', undefined, input as unknown as Record<string, string>);
  }

  async updateChecklist(id: string, name: string): Promise<Checklist> {
    return this.client.put<Checklist>(`/checklists/${id}`, undefined, { name });
  }

  async deleteChecklist(id: string): Promise<void> {
    await this.client.delete(`/checklists/${id}`);
  }

  async getChecklistItems(checklistId: string): Promise<CheckItem[]> {
    return this.client.get<CheckItem[]>(`/checklists/${checklistId}/checkItems`);
  }

  async createCheckItem(checklistId: string, input: CreateCheckItemInput): Promise<CheckItem> {
    return this.client.post<CheckItem>(`/checklists/${checklistId}/checkItems`, undefined, input as unknown as Record<string, string>);
  }

  async updateCheckItem(cardId: string, checkItemId: string, input: Partial<{ name: string; state: 'complete' | 'incomplete'; pos: 'top' | 'bottom' | number }>): Promise<CheckItem> {
    return this.client.put<CheckItem>(`/cards/${cardId}/checkItem/${checkItemId}`, undefined, input as unknown as Record<string, string>);
  }

  async deleteCheckItem(checklistId: string, checkItemId: string): Promise<void> {
    await this.client.delete(`/checklists/${checklistId}/checkItems/${checkItemId}`);
  }

  // ============================================
  // Comments
  // ============================================

  async addComment(cardId: string, text: string): Promise<Action> {
    return this.client.post<Action>(`/cards/${cardId}/actions/comments`, undefined, { text });
  }

  async updateComment(cardId: string, actionId: string, text: string): Promise<Action> {
    return this.client.put<Action>(`/cards/${cardId}/actions/${actionId}/comments`, undefined, { text });
  }

  async deleteComment(cardId: string, actionId: string): Promise<void> {
    await this.client.delete(`/cards/${cardId}/actions/${actionId}/comments`);
  }

  // ============================================
  // Organizations
  // ============================================

  async getOrganization(id: string): Promise<Organization> {
    return this.client.get<Organization>(`/organizations/${id}`);
  }

  async getOrganizationBoards(orgId: string): Promise<Board[]> {
    return this.client.get<Board[]>(`/organizations/${orgId}/boards`);
  }

  async getOrganizationMembers(orgId: string): Promise<Member[]> {
    return this.client.get<Member[]>(`/organizations/${orgId}/members`);
  }

  // ============================================
  // Search
  // ============================================

  async search(query: string, options: {
    idBoards?: string;
    modelTypes?: string;
    board_fields?: string;
    boards_limit?: number;
    card_fields?: string;
    cards_limit?: number;
    cards_page?: number;
    partial?: boolean;
  } = {}): Promise<{ boards?: Board[]; cards?: Card[]; members?: Member[]; organizations?: Organization[] }> {
    return this.client.get('/search', { query, ...options });
  }
}
