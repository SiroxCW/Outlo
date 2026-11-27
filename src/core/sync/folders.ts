import type { FolderRole } from '@shared/api';
import { GraphError, type GraphClient } from '../graph/client';
import { FOLDER_FIELDS, type GraphFolder, type GraphPage } from '../graph/mapping';
import type { RemoteFolder } from '../mail/store';

// Graph's names for the standard folders, in the order the folder pane shows them.
const WELL_KNOWN: [string, FolderRole][] = [
  ['inbox', 'inbox'],
  ['drafts', 'drafts'],
  ['sentitems', 'sent'],
  ['deleteditems', 'deleted'],
  ['junkemail', 'junk'],
  ['archive', 'archive'],
  ['outbox', 'outbox'],
];
const ROLE_ORDER = WELL_KNOWN.map(([, role]) => role);

interface BatchAnswer {
  responses?: { id: string; status: number; body?: { id?: string } }[];
}

// Finds out which folder is the inbox, the drafts folder and so on. Their names depend on the
// language of the mailbox, so only a question by role is reliable.
export async function fetchRoles(client: GraphClient): Promise<Map<string, FolderRole>> {
  const answer = await client.request<BatchAnswer>('/$batch', {
    method: 'POST',
    body: {
      requests: WELL_KNOWN.map(([name]) => ({
        id: name,
        method: 'GET',
        url: `/me/mailFolders/${name}?$select=id`,
        headers: { Prefer: 'IdType="ImmutableId"' },
      })),
    },
  });

  const roles = new Map<string, FolderRole>();
  for (const [name, role] of WELL_KNOWN) {
    const response = answer.responses?.find((entry) => entry.id === name);
    if (response?.status === 200 && response.body?.id) roles.set(response.body.id, role);
    // Every mailbox has an inbox. Without it the answer is not usable.
    else if (role === 'inbox') {
      throw new GraphError(response?.status ?? 0, 'RolesIncomplete', 'The inbox was not found');
    }
  }
  return roles;
}

async function fetchAll(client: GraphClient, path: string): Promise<GraphFolder[]> {
  const folders: GraphFolder[] = [];
  for (let link: string | undefined = path; link;) {
    const page: GraphPage<GraphFolder> = await client.request(link);
    folders.push(...(page.value ?? []));
    link = page['@odata.nextLink'];
  }
  return folders;
}

// Reads the complete folder list. hiddenChildren remembers folders whose children are all hidden,
// so they are not asked again on every round.
export async function fetchFolders(
  client: GraphClient,
  hiddenChildren: Map<string, number>,
): Promise<GraphFolder[]> {
  const byId = new Map<string, GraphFolder>();
  const add = (folders: GraphFolder[]) => {
    const added = folders.filter((folder) => !folder.isHidden && !folder['@removed']);
    for (const folder of added) byId.set(folder.id, folder);
    return added;
  };
  let pending = add(await fetchAll(client, `/me/mailFolders/delta?$select=${FOLDER_FIELDS}`));

  // The list above should contain all levels. Where it does not, ask for the children.
  while (pending.length > 0) {
    const next: GraphFolder[] = [];
    for (const folder of pending) {
      const expected = folder.childFolderCount ?? 0;
      const known = [...byId.values()].filter((entry) => entry.parentFolderId === folder.id);
      if (known.length >= expected || hiddenChildren.get(folder.id) === expected) continue;

      const id = encodeURIComponent(folder.id);
      const children = await fetchAll(
        client,
        `/me/mailFolders/${id}/childFolders?$select=${FOLDER_FIELDS}&$top=100`,
      );
      const added = add(children.filter((child) => !byId.has(child.id)));
      if (added.length === 0) hiddenChildren.set(folder.id, expected);
      next.push(...added);
    }
    pending = next;
  }
  return [...byId.values()];
}

// Brings the folders into the order of the folder pane: standard folders first, then by name,
// every folder followed by its children.
export function toRemoteFolders(
  folders: GraphFolder[],
  roles: Map<string, FolderRole>,
): RemoteFolder[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const rank = (folder: GraphFolder) => {
    const role = roles.get(folder.id);
    return role ? ROLE_ORDER.indexOf(role) : ROLE_ORDER.length;
  };
  const sorted = [...folders].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.displayName ?? '').localeCompare(b.displayName ?? '', undefined, { sensitivity: 'base' }),
  );

  const result: RemoteFolder[] = [];
  const visit = (parentId: string | null) => {
    for (const folder of sorted) {
      // A parent outside the list is the root of the mailbox.
      const parent = ids.has(folder.parentFolderId ?? '') ? folder.parentFolderId! : null;
      if (parent !== parentId) continue;
      result.push({
        remoteId: folder.id,
        parentRemoteId: parent,
        name: folder.displayName ?? '',
        role: roles.get(folder.id) ?? null,
        sortOrder: result.length,
        totalCount: folder.totalItemCount ?? 0,
        unreadCount: folder.unreadItemCount ?? 0,
      });
      visit(folder.id);
    }
  };
  visit(null);
  return result;
}
