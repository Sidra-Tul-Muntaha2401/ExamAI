import crypto from 'node:crypto';
import {
  computeStudentProgressOverview,
  computeTeacherClassAnalytics,
  generateEnrollmentCode,
  normalizeEnrollmentCode,
  normalizeTwoRole,
  type ClassSubmissionMetric,
  type StudentProgressExamInput,
  type StudentProgressPracticeInput,
} from '../src/lib/examRules.ts';
import type {
  AccountStatus,
  AdminAuditLogRecord,
  ClassMemberRecord,
  ClassRecord,
  OfficialExamSummary,
  PlatformSettings,
  StudentProgressSummary,
  TeacherApprovalStatus,
  UserProfile,
  UserRole,
} from '../src/types/index.ts';
import { hashPassword, store } from './store.ts';

function isValidHttpUrlOrEmpty(val: string): boolean {
  if (!val) return true;
  try {
    const u = new URL(val);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export class DomainStore {
  // =========================================================================
  // PLATFORM SETTINGS
  // =========================================================================
  async getPlatformSettings(): Promise<PlatformSettings> {
    const defaults: PlatformSettings = {
      allowTeacherRegistration: true,
      requireTeacherApproval: true,
      defaultMaxTabSwitches: 3,
      allowPublicPractice: true,
    };

    try {
      if (store.provider === 'supabase') {
        const { data } = await store.getSupa().from('platform_settings').select('key, value');
        const map = new Map((data || []).map((r) => [String(r.key), String(r.value)]));
        return {
          allowTeacherRegistration: map.get('allowTeacherRegistration') !== 'false',
          requireTeacherApproval: map.get('requireTeacherApproval') !== 'false',
          defaultMaxTabSwitches: Number(map.get('defaultMaxTabSwitches') || '3') || 3,
          allowPublicPractice: map.get('allowPublicPractice') !== 'false',
        };
      }

      const rows = store.getSql().prepare('SELECT key, value FROM platform_settings').all() as Array<{
        key: string;
        value: string;
      }>;
      const map = new Map(rows.map((r) => [r.key, r.value]));
      return {
        allowTeacherRegistration: map.get('allowTeacherRegistration') !== 'false',
        requireTeacherApproval: map.get('requireTeacherApproval') !== 'false',
        defaultMaxTabSwitches: Number(map.get('defaultMaxTabSwitches') || '3') || 3,
        allowPublicPractice: map.get('allowPublicPractice') !== 'false',
      };
    } catch {
      return defaults;
    }
  }

  async updatePlatformSettings(
    patch: Partial<PlatformSettings>,
    adminId: string
  ): Promise<PlatformSettings> {
    const current = await this.getPlatformSettings();
    const next: PlatformSettings = {
      allowTeacherRegistration:
        typeof patch.allowTeacherRegistration === 'boolean'
          ? patch.allowTeacherRegistration
          : current.allowTeacherRegistration,
      requireTeacherApproval:
        typeof patch.requireTeacherApproval === 'boolean'
          ? patch.requireTeacherApproval
          : current.requireTeacherApproval,
      defaultMaxTabSwitches:
        typeof patch.defaultMaxTabSwitches === 'number' && Number.isFinite(patch.defaultMaxTabSwitches)
          ? Math.max(0, Math.min(10, Math.round(patch.defaultMaxTabSwitches)))
          : current.defaultMaxTabSwitches,
      allowPublicPractice:
        typeof patch.allowPublicPractice === 'boolean'
          ? patch.allowPublicPractice
          : current.allowPublicPractice,
    };

    const now = new Date().toISOString();
    const entries: Array<[string, string]> = [
      ['allowTeacherRegistration', String(next.allowTeacherRegistration)],
      ['requireTeacherApproval', String(next.requireTeacherApproval)],
      ['defaultMaxTabSwitches', String(next.defaultMaxTabSwitches)],
      ['allowPublicPractice', String(next.allowPublicPractice)],
    ];

    if (store.provider === 'supabase') {
      await store.getSupa().from('platform_settings').upsert(
        entries.map(([key, value]) => ({
          key,
          value,
          updated_by: adminId,
          updated_at: now,
        })),
        { onConflict: 'key' }
      );
    } else {
      const stmt = store.getSql().prepare(
        `INSERT INTO platform_settings (key, value, updated_by, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      );
      for (const [key, value] of entries) {
        stmt.run(key, value, adminId, now);
      }
    }

    await this.recordAdminAuditLog({
      adminId,
      action: 'update_platform_settings',
      targetType: 'platform_settings',
      targetId: 'global',
      details: `Updated platform settings (teacherReg=${next.allowTeacherRegistration}, teacherApproval=${next.requireTeacherApproval}, maxTabSwitches=${next.defaultMaxTabSwitches}, publicPractice=${next.allowPublicPractice})`,
    });

    return next;
  }

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: string): Promise<void> {
    const id = `prt_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      await sb.from('password_reset_tokens').insert({
        id,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: createdAt,
      });
      return;
    }
    store
      .getSql()
      .prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, userId, tokenHash, expiresAt, createdAt);
  }

  async consumePasswordResetToken(
    tokenHash: string,
    newPasswordHash: string
  ): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
    const now = new Date().toISOString();
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: row, error } = await sb
        .from('password_reset_tokens')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error || !row) return { ok: false, error: 'Invalid or expired reset token.' };
      if (row.used_at || Date.parse(String(row.expires_at)) < Date.now()) {
        return { ok: false, error: 'Reset token has expired or already been used.' };
      }
      await sb.from('users').update({ password_hash: newPasswordHash, updated_at: now }).eq('id', String(row.user_id));
      await sb.from('password_reset_tokens').update({ used_at: now }).eq('id', String(row.id));
      await sb.from('sessions').delete().eq('user_id', String(row.user_id));
      return { ok: true, userId: String(row.user_id) };
    }

    const db = store.getSql();
    const row = db
      .prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?')
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!row) return { ok: false, error: 'Invalid or expired reset token.' };
    if (row.used_at || Date.parse(String(row.expires_at)) < Date.now()) {
      return { ok: false, error: 'Reset token has expired or already been used.' };
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      newPasswordHash,
      now,
      String(row.user_id)
    );
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, String(row.id));
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(String(row.user_id));
    return { ok: true, userId: String(row.user_id) };
  }

  async updateOwnProfile(
    userId: string,
    role: UserRole,
    patch: { name?: string; institution?: string; avatarUrl?: string; subject?: string; bio?: string }
  ): Promise<UserProfile | null> {
    const existing = await store.findUserById(userId);
    if (!existing) return null;

    const name = typeof patch.name === 'string' && patch.name.trim().length >= 2 ? patch.name.trim().slice(0, 80) : existing.name;
    const institution =
      typeof patch.institution === 'string' ? patch.institution.trim().slice(0, 120) : existing.institution || '';
    const avatarRaw = typeof patch.avatarUrl === 'string' ? patch.avatarUrl.trim().slice(0, 500) : existing.avatarUrl || '';
    const avatarUrl = isValidHttpUrlOrEmpty(avatarRaw) ? avatarRaw : existing.avatarUrl || '';
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      await sb
        .from('users')
        .update({ name, institution, avatar_url: avatarUrl, updated_at: now })
        .eq('id', userId);
      await sb
        .from('profiles')
        .update({ full_name: name, institution, avatar_url: avatarUrl, updated_at: now })
        .eq('id', userId);
      if (role === 'teacher') {
        const subject =
          typeof patch.subject === 'string'
            ? patch.subject.trim().slice(0, 120)
            : existing.teacherProfile?.subject || '';
        const bio =
          typeof patch.bio === 'string'
            ? patch.bio.trim().slice(0, 800)
            : existing.teacherProfile?.bio || '';
        await sb
          .from('teacher_profiles')
          .update({ subject, institution, bio, updated_at: now })
          .eq('user_id', userId);
      }
      return store.findUserById(userId);
    }

    const db = store.getSql();
    db.prepare('UPDATE users SET name = ?, institution = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(
      name,
      institution,
      avatarUrl,
      now,
      userId
    );
    db.prepare('UPDATE profiles SET full_name = ?, institution = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(
      name,
      institution,
      avatarUrl,
      now,
      userId
    );
    if (role === 'teacher') {
      const subject =
        typeof patch.subject === 'string'
          ? patch.subject.trim().slice(0, 120)
          : existing.teacherProfile?.subject || '';
      const bio =
        typeof patch.bio === 'string'
          ? patch.bio.trim().slice(0, 800)
          : existing.teacherProfile?.bio || '';
      db.prepare('UPDATE teacher_profiles SET subject = ?, institution = ?, bio = ?, updated_at = ? WHERE user_id = ?').run(
        subject,
        institution,
        bio,
        now,
        userId
      );
    }
    return store.findUserById(userId);
  }

  // =========================================================================
  // ADMIN BOOTSTRAP, AUDIT LOGS & SUPABASE AUTH USER SYNC
  // =========================================================================
  async countAdminUsers(): Promise<number> {
    if (store.provider === 'supabase') {
      const { count, error } = await store
        .getSupa()
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (error) throw new Error(error.message);
      return count || 0;
    }
    const row = store
      .getSql()
      .prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'")
      .get() as { c: number } | undefined;
    return Number(row?.c || 0);
  }

  async recordAdminAuditLog(input: {
    adminId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details?: string;
  }): Promise<void> {
    const id = `aud_${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const details = (input.details || '').slice(0, 500);
    try {
      if (store.provider === 'supabase') {
        await store.getSupa().from('admin_audit_logs').insert({
          id,
          admin_id: input.adminId,
          action: input.action,
          target_type: input.targetType,
          target_id: input.targetId,
          details,
          created_at: createdAt,
        });
        return;
      }
      store
        .getSql()
        .prepare(
          `INSERT INTO admin_audit_logs (id, admin_id, action, target_type, target_id, details, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, input.adminId, input.action, input.targetType, input.targetId, details, createdAt);
    } catch {
      // Non-blocking audit logging
    }
  }

  async listAdminAuditLogs(limit = 100): Promise<AdminAuditLogRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, limit));
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: logs, error } = await sb
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(safeLimit);
      if (error) throw new Error(error.message);
      const adminIds = Array.from(
        new Set((logs || []).map((l) => (l.admin_id ? String(l.admin_id) : '')).filter(Boolean))
      );
      const adminMap = new Map<string, string>();
      if (adminIds.length > 0) {
        const { data: admins } = await sb.from('users').select('id, name').in('id', adminIds);
        for (const a of admins || []) {
          adminMap.set(String(a.id), String(a.name));
        }
      }
      return (logs || []).map((l) => ({
        id: String(l.id),
        adminId: l.admin_id ? String(l.admin_id) : null,
        adminName: l.admin_id ? adminMap.get(String(l.admin_id)) || 'Admin' : 'System',
        action: String(l.action),
        targetType: String(l.target_type),
        targetId: String(l.target_id),
        details: String(l.details || ''),
        createdAt: String(l.created_at),
      }));
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT a.*, u.name as admin_name
         FROM admin_audit_logs a
         LEFT JOIN users u ON u.id = a.admin_id
         ORDER BY a.created_at DESC
         LIMIT ?`
      )
      .all(safeLimit);

    return rows.map((l) => ({
      id: String(l.id),
      adminId: l.admin_id ? String(l.admin_id) : null,
      adminName: l.admin_name ? String(l.admin_name) : l.admin_id ? 'Admin' : 'System',
      action: String(l.action),
      targetType: String(l.target_type),
      targetId: String(l.target_id),
      details: String(l.details || ''),
      createdAt: String(l.created_at),
    }));
  }

  async claimInitialAdmin(input: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    institution?: string;
    createdAt: string;
  }): Promise<{ ok: true; user: UserProfile } | { ok: false; status: number; error: string }> {
    const cleanEmail = input.email.trim().toLowerCase();
    const adminCount = await this.countAdminUsers();
    if (adminCount > 0) {
      return {
        ok: false,
        status: 409,
        error: 'An Admin account already exists. Sign in as an Admin or provide the Admin Setup Secret.',
      };
    }

    const existing = await store.findUserByEmail(cleanEmail);
    if (existing) {
      return { ok: false, status: 409, error: 'An account with this email already exists.' };
    }

    await store.createUser({
      id: input.id,
      name: input.name,
      email: cleanEmail,
      password_hash: input.passwordHash,
      role: 'admin',
      institution: input.institution || 'ExamAI Administration',
      account_status: 'active',
      created_at: input.createdAt,
    });

    await this.recordAdminAuditLog({
      adminId: input.id,
      action: 'claim_initial_admin',
      targetType: 'user',
      targetId: input.id,
      details: `Claimed initial Admin account (${cleanEmail})`,
    });

    const created = await store.findUserById(input.id);
    if (!created) {
      return { ok: false, status: 500, error: 'Unable to load newly claimed Admin account.' };
    }
    return { ok: true, user: created };
  }

  async findOrCreateDemoAdmin(): Promise<UserProfile | null> {
    if (
      process.env.DISABLE_DEMO_LOGIN === 'true' ||
      process.env.ENABLE_DEMO_LOGIN !== 'true'
    ) {
      return null;
    }

    const existingById = await store.findUserById('usr_admin_demo');
    if (existingById) return existingById;

    const existingByEmail = await store.findUserByEmail('admin@exampilot.edu');
    if (existingByEmail) return store.findUserById(existingByEmail.id);

    const now = new Date().toISOString();
    await store.createUser({
      id: 'usr_admin_demo',
      name: 'Alex Mercer (Admin)',
      email: 'admin@exampilot.edu',
      password_hash: hashPassword('Admin123!'),
      role: 'admin',
      institution: 'ExamAI Administration',
      account_status: 'active',
      created_at: now,
    });

    return store.findUserById('usr_admin_demo');
  }

  async syncSupabaseUser(input: {
    authUserId: string;
    email: string;
    fullName: string;
    requestedRole?: UserRole;
    institution?: string;
    subject?: string;
    bio?: string;
    setupSecret?: string;
  }): Promise<{ user: UserProfile } | { error: string; status: number }> {
    const cleanEmail = input.email.trim().toLowerCase();
    const existingByEmail = await store.findUserByEmail(cleanEmail);

    if (existingByEmail) {
      if (existingByEmail.auth_user_id && existingByEmail.auth_user_id !== input.authUserId) {
        return { error: 'Account is linked to a different authentication identity.', status: 409 };
      }
      if (!existingByEmail.auth_user_id) {
        const now = new Date().toISOString();
        if (store.provider === 'supabase') {
          await store.getSupa().from('users').update({ auth_user_id: input.authUserId, updated_at: now }).eq('id', existingByEmail.id);
          await store.getSupa().from('profiles').update({ auth_user_id: input.authUserId, updated_at: now }).eq('id', existingByEmail.id);
        } else {
          store.getSql().prepare('UPDATE users SET auth_user_id = ?, updated_at = ? WHERE id = ?').run(input.authUserId, now, existingByEmail.id);
          store.getSql().prepare('UPDATE profiles SET auth_user_id = ?, updated_at = ? WHERE id = ?').run(input.authUserId, now, existingByEmail.id);
        }
      }
      const user = await store.findUserById(existingByEmail.id);
      if (!user) return { error: 'User profile could not be loaded.', status: 404 };
      return { user };
    }

    const settings = await this.getPlatformSettings();
    let role: UserRole = normalizeTwoRole(input.requestedRole);

    if (input.requestedRole === 'admin') {
      const adminCount = await this.countAdminUsers();
      if (adminCount > 0) {
        const expectedSecret = (process.env.ADMIN_BOOTSTRAP_SECRET || '').trim();
        const providedSecret = (input.setupSecret || '').trim();
        if (!expectedSecret) {
          return {
            error:
              'An Admin account already exists and ADMIN_BOOTSTRAP_SECRET is not configured on the server.',
            status: 403,
          };
        }
        const aBuf = Buffer.from(providedSecret);
        const bBuf = Buffer.from(expectedSecret);
        const secretValid = aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
        if (!secretValid) {
          return { error: 'Invalid Admin Setup Secret.', status: 403 };
        }
      }
      role = 'admin';
    } else if (role === 'teacher' && !settings.allowTeacherRegistration) {
      return {
        error: 'Self-service teacher registration is currently disabled by administrator.',
        status: 403,
      };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const approvalStatus: TeacherApprovalStatus =
      role === 'teacher' ? (settings.requireTeacherApproval ? 'pending' : 'approved') : 'approved';

    await store.createUser(
      {
        id: userId,
        auth_user_id: input.authUserId,
        name: input.fullName.trim().slice(0, 80) || cleanEmail.split('@')[0],
        email: cleanEmail,
        password_hash: '',
        role,
        institution: (input.institution || '').trim().slice(0, 120),
        account_status: 'active',
        created_at: now,
      },
      role === 'teacher'
        ? {
            subject: (input.subject || '').trim().slice(0, 120),
            bio: (input.bio || '').trim().slice(0, 800),
            approvalStatus,
          }
        : undefined
    );

    if (role === 'admin') {
      await this.recordAdminAuditLog({
        adminId: userId,
        action: 'sync_supabase_admin',
        targetType: 'user',
        targetId: userId,
        details: `Provisioned Supabase Admin account (${cleanEmail})`,
      });
    }

    const created = await store.findUserById(userId);
    if (!created) return { error: 'Unable to provision synchronized account.', status: 500 };
    return { user: created };
  }

  // =========================================================================
  // CLASSES & ENROLLMENT (TEACHER & STUDENT)
  // =========================================================================
  private async generateUniqueClassCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateEnrollmentCode(crypto.randomBytes(6));
      if (store.provider === 'supabase') {
        const { data } = await store
          .getSupa()
          .from('classes')
          .select('id')
          .eq('enrollment_code', candidate)
          .maybeSingle();
        if (!data) return candidate;
      } else {
        const existing = store.getSql().prepare('SELECT id FROM classes WHERE enrollment_code = ?').get(candidate);
        if (!existing) return candidate;
      }
    }
    return `EXAM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }

  async listTeacherClasses(teacherId: string): Promise<ClassRecord[]> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: classes, error } = await sb
        .from('classes')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!classes || classes.length === 0) return [];
      const classIds = classes.map((c) => String(c.id));
      const [{ data: members }, { data: asgs }] = await Promise.all([
        sb.from('class_members').select('class_id').eq('status', 'active').in('class_id', classIds),
        sb.from('exam_assignments').select('class_id, exam_id').in('class_id', classIds),
      ]);
      const memCount = new Map<string, number>();
      for (const m of members || []) {
        const cid = String(m.class_id);
        memCount.set(cid, (memCount.get(cid) || 0) + 1);
      }
      const exSet = new Map<string, Set<string>>();
      for (const a of asgs || []) {
        const cid = String(a.class_id);
        const s = exSet.get(cid) || new Set<string>();
        s.add(String(a.exam_id));
        exSet.set(cid, s);
      }
      return classes.map((c) => ({
        id: String(c.id),
        teacherId: String(c.teacher_id),
        name: String(c.name),
        description: String(c.description || ''),
        subject: String(c.subject || ''),
        enrollmentCode: String(c.enrollment_code),
        status: (c.status as 'active' | 'archived') || 'active',
        memberCount: memCount.get(String(c.id)) || 0,
        assignedExamCount: exSet.get(String(c.id))?.size || 0,
        createdAt: String(c.created_at),
        updatedAt: c.updated_at ? String(c.updated_at) : null,
      }));
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id AND cm.status = 'active') as member_count,
          (SELECT COUNT(DISTINCT ea.exam_id) FROM exam_assignments ea WHERE ea.class_id = c.id) as assigned_exam_count
         FROM classes c
         WHERE c.teacher_id = ?
         ORDER BY c.created_at DESC`
      )
      .all(teacherId);

    return rows.map((c) => ({
      id: String(c.id),
      teacherId: String(c.teacher_id),
      name: String(c.name),
      description: String(c.description || ''),
      subject: String(c.subject || ''),
      enrollmentCode: String(c.enrollment_code),
      status: (c.status as 'active' | 'archived') || 'active',
      memberCount: Number(c.member_count || 0),
      assignedExamCount: Number(c.assigned_exam_count || 0),
      createdAt: String(c.created_at),
      updatedAt: c.updated_at ? String(c.updated_at) : null,
    }));
  }

  async createClass(input: {
    teacherId: string;
    name: string;
    subject: string;
    description: string;
  }): Promise<ClassRecord> {
    const id = `cls_${crypto.randomUUID()}`;
    const enrollmentCode = await this.generateUniqueClassCode();
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      const { error } = await store.getSupa().from('classes').insert({
        id,
        teacher_id: input.teacherId,
        name: input.name,
        description: input.description,
        subject: input.subject,
        enrollment_code: enrollmentCode,
        status: 'active',
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error(error.message);
    } else {
      store
        .getSql()
        .prepare(
          `INSERT INTO classes (id, teacher_id, name, description, subject, enrollment_code, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        )
        .run(id, input.teacherId, input.name, input.description, input.subject, enrollmentCode, now, now);
    }

    return {
      id,
      teacherId: input.teacherId,
      name: input.name,
      description: input.description,
      subject: input.subject,
      enrollmentCode,
      status: 'active',
      memberCount: 0,
      assignedExamCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateClass(
    classId: string,
    teacherId: string,
    patch: {
      name?: string;
      subject?: string;
      description?: string;
      status?: 'active' | 'archived';
      regenerateCode?: boolean;
    }
  ): Promise<ClassRecord | null> {
    const classes = await this.listTeacherClasses(teacherId);
    const current = classes.find((c) => c.id === classId);
    if (!current) return null;

    const name = typeof patch.name === 'string' && patch.name.trim().length >= 2 ? patch.name.trim() : current.name;
    const subject = typeof patch.subject === 'string' ? patch.subject.trim() : current.subject;
    const description = typeof patch.description === 'string' ? patch.description.trim() : current.description;
    const status = patch.status === 'archived' ? 'archived' : patch.status === 'active' ? 'active' : current.status;
    const enrollmentCode = patch.regenerateCode ? await this.generateUniqueClassCode() : current.enrollmentCode;
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      await store
        .getSupa()
        .from('classes')
        .update({ name, subject, description, status, enrollment_code: enrollmentCode, updated_at: now })
        .eq('id', classId)
        .eq('teacher_id', teacherId);
    } else {
      store
        .getSql()
        .prepare(
          `UPDATE classes
           SET name = ?, subject = ?, description = ?, status = ?, enrollment_code = ?, updated_at = ?
           WHERE id = ? AND teacher_id = ?`
        )
        .run(name, subject, description, status, enrollmentCode, now, classId, teacherId);
    }

    return { ...current, name, subject, description, status, enrollmentCode, updatedAt: now };
  }

  async getClassWithRoster(
    classId: string,
    teacherId: string
  ): Promise<{ classRecord: ClassRecord; members: ClassMemberRecord[] } | null> {
    const classes = await this.listTeacherClasses(teacherId);
    const classRecord = classes.find((c) => c.id === classId);
    if (!classRecord) return null;

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: memRows, error } = await sb
        .from('class_members')
        .select('*')
        .eq('class_id', classId)
        .eq('status', 'active')
        .order('joined_at', { ascending: false });
      if (error) throw new Error(error.message);
      const studentIds = (memRows || []).map((m) => String(m.student_id));
      if (studentIds.length === 0) return { classRecord, members: [] };

      const [{ data: users }, { data: teacherExams }, { data: results }] = await Promise.all([
        sb.from('users').select('id, name, email, institution').in('id', studentIds),
        sb.from('exams').select('id').eq('teacher_id', teacherId),
        sb.from('results').select('student_id, exam_id, percentage, status').in('student_id', studentIds),
      ]);
      const userMap = new Map((users || []).map((u) => [String(u.id), u as Record<string, unknown>]));
      const teacherExamSet = new Set((teacherExams || []).map((e) => String(e.id)));

      const members: ClassMemberRecord[] = (memRows || []).map((m) => {
        const sid = String(m.student_id);
        const u = userMap.get(sid);
        const stuRes = (results || []).filter((r) => String(r.student_id) === sid && teacherExamSet.has(String(r.exam_id)));
        const evalRes = stuRes.filter((r) => r.status === 'evaluated');
        const avg =
          evalRes.length > 0
            ? Math.round((evalRes.reduce((acc, r) => acc + Number(r.percentage), 0) / evalRes.length) * 10) / 10
            : null;
        return {
          id: String(m.id),
          classId,
          studentId: sid,
          studentName: u ? String(u.name) : 'Student',
          studentEmail: u ? String(u.email) : '',
          institution: u ? String(u.institution || '') : '',
          joinedAt: String(m.joined_at),
          status: 'active',
          completedExamsCount: stuRes.length,
          avgPercentage: avg,
        };
      });
      return { classRecord, members };
    }

    const db = store.getSql();
    const rows = db
      .prepare(
        `SELECT cm.*, u.name as student_name, u.email as student_email, u.institution as institution,
          (SELECT COUNT(*) FROM results r JOIN exams e ON e.id = r.exam_id WHERE r.student_id = cm.student_id AND e.teacher_id = ?) as completed_count,
          (SELECT AVG(r.percentage) FROM results r JOIN exams e ON e.id = r.exam_id WHERE r.student_id = cm.student_id AND e.teacher_id = ? AND r.status = 'evaluated') as avg_pct
         FROM class_members cm
         JOIN users u ON u.id = cm.student_id
         WHERE cm.class_id = ? AND cm.status = 'active'
         ORDER BY cm.joined_at DESC`
      )
      .all(teacherId, teacherId, classId);

    const members: ClassMemberRecord[] = rows.map((m) => ({
      id: String(m.id),
      classId,
      studentId: String(m.student_id),
      studentName: String(m.student_name),
      studentEmail: String(m.student_email),
      institution: String(m.institution || ''),
      joinedAt: String(m.joined_at),
      status: 'active',
      completedExamsCount: Number(m.completed_count || 0),
      avgPercentage: m.avg_pct !== null && m.avg_pct !== undefined ? Math.round(Number(m.avg_pct) * 10) / 10 : null,
    }));

    return { classRecord, members };
  }

  async addStudentToClass(
    classId: string,
    teacherId: string,
    identifier: string
  ): Promise<{ ok: true; member: ClassMemberRecord } | { ok: false; error: string; status: number }> {
    const classes = await this.listTeacherClasses(teacherId);
    const cls = classes.find((c) => c.id === classId);
    if (!cls) return { ok: false, error: 'Class not found or access denied.', status: 404 };

    const clean = identifier.trim();
    const targetUser = clean.includes('@')
      ? await store.findUserByEmail(clean)
      : null;

    let studentProfile: UserProfile | null = targetUser
      ? await store.findUserById(targetUser.id)
      : await store.findUserById(clean);

    if (!studentProfile || studentProfile.role !== 'student') {
      return { ok: false, error: 'No active student account found matching that email or ID.', status: 404 };
    }

    const now = new Date().toISOString();
    const memId = `cm_${crypto.randomUUID()}`;

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      await sb.from('class_members').upsert(
        {
          id: memId,
          class_id: classId,
          student_id: studentProfile.id,
          joined_at: now,
          status: 'active',
        },
        { onConflict: 'class_id,student_id' }
      );
    } else {
      store
        .getSql()
        .prepare(
          `INSERT INTO class_members (id, class_id, student_id, joined_at, status)
           VALUES (?, ?, ?, ?, 'active')
           ON CONFLICT(class_id, student_id) DO UPDATE SET status = 'active', joined_at = excluded.joined_at`
        )
        .run(memId, classId, studentProfile.id, now);
    }

    return {
      ok: true,
      member: {
        id: memId,
        classId,
        studentId: studentProfile.id,
        studentName: studentProfile.name,
        studentEmail: studentProfile.email,
        institution: studentProfile.institution || '',
        joinedAt: now,
        status: 'active',
        completedExamsCount: 0,
        avgPercentage: null,
      },
    };
  }

  async removeStudentFromClass(classId: string, teacherId: string, studentId: string): Promise<boolean> {
    const classes = await this.listTeacherClasses(teacherId);
    if (!classes.some((c) => c.id === classId)) return false;

    if (store.provider === 'supabase') {
      const { data } = await store
        .getSupa()
        .from('class_members')
        .update({ status: 'removed' })
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .select('id');
      return Boolean(data && data.length > 0);
    }

    const res = store
      .getSql()
      .prepare("UPDATE class_members SET status = 'removed' WHERE class_id = ? AND student_id = ?")
      .run(classId, studentId);
    return Number(res.changes || 0) > 0;
  }

  async listStudentClasses(studentId: string): Promise<ClassRecord[]> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: memberships, error } = await sb
        .from('class_members')
        .select('class_id, joined_at')
        .eq('student_id', studentId)
        .eq('status', 'active');
      if (error) throw new Error(error.message);
      const classIds = (memberships || []).map((m) => String(m.class_id));
      if (classIds.length === 0) return [];
      const { data: classes } = await sb.from('classes').select('*').in('id', classIds).order('created_at', { ascending: false });
      if (!classes || classes.length === 0) return [];
      const teacherIds = Array.from(new Set(classes.map((c) => String(c.teacher_id))));
      const [{ data: teachers }, { data: allMems }, { data: asgs }] = await Promise.all([
        sb.from('users').select('id, name').in('id', teacherIds),
        sb.from('class_members').select('class_id').eq('status', 'active').in('class_id', classIds),
        sb.from('exam_assignments').select('class_id, exam_id').in('class_id', classIds),
      ]);
      const tMap = new Map((teachers || []).map((t) => [String(t.id), String(t.name)]));
      const memCount = new Map<string, number>();
      for (const m of allMems || []) memCount.set(String(m.class_id), (memCount.get(String(m.class_id)) || 0) + 1);
      const exSet = new Map<string, Set<string>>();
      for (const a of asgs || []) {
        const s = exSet.get(String(a.class_id)) || new Set<string>();
        s.add(String(a.exam_id));
        exSet.set(String(a.class_id), s);
      }
      return classes.map((c) => ({
        id: String(c.id),
        teacherId: String(c.teacher_id),
        teacherName: tMap.get(String(c.teacher_id)) || 'Instructor',
        name: String(c.name),
        description: String(c.description || ''),
        subject: String(c.subject || ''),
        enrollmentCode: String(c.enrollment_code),
        status: (c.status as 'active' | 'archived') || 'active',
        memberCount: memCount.get(String(c.id)) || 0,
        assignedExamCount: exSet.get(String(c.id))?.size || 0,
        createdAt: String(c.created_at),
      }));
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT c.*, u.name as teacher_name,
          (SELECT COUNT(*) FROM class_members cm2 WHERE cm2.class_id = c.id AND cm2.status = 'active') as member_count,
          (SELECT COUNT(DISTINCT ea.exam_id) FROM exam_assignments ea WHERE ea.class_id = c.id) as assigned_exam_count
         FROM class_members cm
         JOIN classes c ON c.id = cm.class_id
         JOIN users u ON u.id = c.teacher_id
         WHERE cm.student_id = ? AND cm.status = 'active'
         ORDER BY cm.joined_at DESC`
      )
      .all(studentId);

    return rows.map((c) => ({
      id: String(c.id),
      teacherId: String(c.teacher_id),
      teacherName: String(c.teacher_name || 'Instructor'),
      name: String(c.name),
      description: String(c.description || ''),
      subject: String(c.subject || ''),
      enrollmentCode: String(c.enrollment_code),
      status: (c.status as 'active' | 'archived') || 'active',
      memberCount: Number(c.member_count || 0),
      assignedExamCount: Number(c.assigned_exam_count || 0),
      createdAt: String(c.created_at),
    }));
  }

  async joinClassByCode(
    studentId: string,
    rawCode: string
  ): Promise<{ ok: true; classRecord: ClassRecord } | { ok: false; error: string; status: number }> {
    const code = normalizeEnrollmentCode(rawCode);
    if (!code || code.length < 4) {
      return { ok: false, error: 'Enter a valid class enrollment code (e.g. EXAM-CS301A).', status: 400 };
    }

    let clsRow: Record<string, unknown> | undefined;
    if (store.provider === 'supabase') {
      const { data } = await store
        .getSupa()
        .from('classes')
        .select('*')
        .eq('enrollment_code', code)
        .maybeSingle();
      clsRow = (data as Record<string, unknown> | null) ?? undefined;
    } else {
      clsRow = store
        .getSql()
        .prepare('SELECT * FROM classes WHERE UPPER(enrollment_code) = ?')
        .get(code);
    }

    if (!clsRow) {
      return { ok: false, error: 'No class matched that enrollment code.', status: 404 };
    }
    if (clsRow.status === 'archived') {
      return { ok: false, error: 'This class is archived and no longer accepting enrollments.', status: 403 };
    }

    const now = new Date().toISOString();
    const memId = `cm_${crypto.randomUUID()}`;
    if (store.provider === 'supabase') {
      await store.getSupa().from('class_members').upsert(
        {
          id: memId,
          class_id: String(clsRow.id),
          student_id: studentId,
          joined_at: now,
          status: 'active',
        },
        { onConflict: 'class_id,student_id' }
      );
    } else {
      store
        .getSql()
        .prepare(
          `INSERT INTO class_members (id, class_id, student_id, joined_at, status)
           VALUES (?, ?, ?, ?, 'active')
           ON CONFLICT(class_id, student_id) DO UPDATE SET status = 'active', joined_at = excluded.joined_at`
        )
        .run(memId, String(clsRow.id), studentId, now);
    }

    const classes = await this.listStudentClasses(studentId);
    const joined = classes.find((c) => c.id === String(clsRow!.id));
    return {
      ok: true,
      classRecord: joined || {
        id: String(clsRow.id),
        teacherId: String(clsRow.teacher_id),
        name: String(clsRow.name),
        description: String(clsRow.description || ''),
        subject: String(clsRow.subject || ''),
        enrollmentCode: String(clsRow.enrollment_code),
        status: 'active',
        memberCount: 1,
        createdAt: String(clsRow.created_at),
      },
    };
  }

  async leaveClass(studentId: string, classId: string): Promise<boolean> {
    if (store.provider === 'supabase') {
      const { data } = await store
        .getSupa()
        .from('class_members')
        .update({ status: 'removed' })
        .eq('class_id', classId)
        .eq('student_id', studentId)
        .select('id');
      return Boolean(data && data.length > 0);
    }
    const res = store
      .getSql()
      .prepare("UPDATE class_members SET status = 'removed' WHERE class_id = ? AND student_id = ?")
      .run(classId, studentId);
    return Number(res.changes || 0) > 0;
  }

  // =========================================================================
  // TEACHER SCOPED STUDENTS & ANALYTICS
  // =========================================================================
  async listTeacherEnrolledStudents(teacherId: string): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      institution: string;
      created_at: string;
      classNames: string[];
      completedExamsCount: number;
      avgPercentage: number | null;
    }>
  > {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const [{ data: classes }, { data: exams }] = await Promise.all([
        sb.from('classes').select('id, name').eq('teacher_id', teacherId),
        sb.from('exams').select('id').eq('teacher_id', teacherId),
      ]);
      const classIds = (classes || []).map((c) => String(c.id));
      const examIds = (exams || []).map((e) => String(e.id));
      const classNameMap = new Map((classes || []).map((c) => [String(c.id), String(c.name)]));

      const [{ data: members }, { data: attempts }, { data: results }] = await Promise.all([
        classIds.length > 0
          ? sb.from('class_members').select('class_id, student_id').eq('status', 'active').in('class_id', classIds)
          : Promise.resolve({ data: [] }),
        examIds.length > 0
          ? sb.from('exam_attempts').select('student_id').in('exam_id', examIds)
          : Promise.resolve({ data: [] }),
        examIds.length > 0
          ? sb.from('results').select('student_id, percentage, status').in('exam_id', examIds)
          : Promise.resolve({ data: [] }),
      ]);

      const studentClassNames = new Map<string, Set<string>>();
      const scopedIds = new Set<string>();
      for (const m of members || []) {
        const sid = String(m.student_id);
        scopedIds.add(sid);
        const s = studentClassNames.get(sid) || new Set<string>();
        const cname = classNameMap.get(String(m.class_id));
        if (cname) s.add(cname);
        studentClassNames.set(sid, s);
      }
      for (const a of attempts || []) {
        scopedIds.add(String(a.student_id));
      }

      if (scopedIds.size === 0) return [];
      const { data: users } = await sb
        .from('users')
        .select('id, name, email, institution, created_at')
        .eq('role', 'student')
        .eq('account_status', 'active')
        .in('id', Array.from(scopedIds));

      return (users || []).map((u) => {
        const sid = String(u.id);
        const stuRes = (results || []).filter((r) => String(r.student_id) === sid);
        const evalRes = stuRes.filter((r) => r.status === 'evaluated');
        const avg =
          evalRes.length > 0
            ? Math.round((evalRes.reduce((acc, r) => acc + Number(r.percentage), 0) / evalRes.length) * 10) / 10
            : null;
        return {
          id: sid,
          name: String(u.name),
          email: String(u.email),
          institution: String(u.institution || ''),
          created_at: String(u.created_at),
          classNames: Array.from(studentClassNames.get(sid) || []),
          completedExamsCount: stuRes.length,
          avgPercentage: avg,
        };
      });
    }

    const db = store.getSql();
    const rows = db
      .prepare(
        `SELECT DISTINCT u.id, u.name, u.email, u.institution, u.created_at
         FROM users u
         WHERE u.role = 'student' AND u.account_status = 'active'
           AND (
             EXISTS (
               SELECT 1 FROM class_members cm
               JOIN classes c ON c.id = cm.class_id
               WHERE cm.student_id = u.id AND cm.status = 'active' AND c.teacher_id = ?
             )
             OR EXISTS (
               SELECT 1 FROM exam_attempts ea
               JOIN exams e ON e.id = ea.exam_id
               WHERE ea.student_id = u.id AND e.teacher_id = ?
             )
           )
         ORDER BY u.name ASC`
      )
      .all(teacherId, teacherId);

    const getClasses = db.prepare(
      `SELECT c.name FROM class_members cm JOIN classes c ON c.id = cm.class_id
       WHERE cm.student_id = ? AND cm.status = 'active' AND c.teacher_id = ?`
    );
    const getStats = db.prepare(
      `SELECT COUNT(*) as cnt, AVG(CASE WHEN r.status = 'evaluated' THEN r.percentage END) as avg_pct
       FROM results r JOIN exams e ON e.id = r.exam_id
       WHERE r.student_id = ? AND e.teacher_id = ?`
    );

    return rows.map((u) => {
      const sid = String(u.id);
      const cls = getClasses.all(sid, teacherId) as Array<{ name: string }>;
      const st = getStats.get(sid, teacherId) as { cnt: number; avg_pct: number | null };
      return {
        id: sid,
        name: String(u.name),
        email: String(u.email),
        institution: String(u.institution || ''),
        created_at: String(u.created_at),
        classNames: cls.map((c) => c.name),
        completedExamsCount: Number(st?.cnt || 0),
        avgPercentage:
          st?.avg_pct !== null && st?.avg_pct !== undefined ? Math.round(Number(st.avg_pct) * 10) / 10 : null,
      };
    });
  }

  async getTeacherClassAnalytics(teacherId: string, classId?: string) {
    const classes = await this.listTeacherClasses(teacherId);
    const targetClass = classId ? classes.find((c) => c.id === classId) || null : null;

    let members: Array<{ studentId: string; studentName: string; studentEmail: string }> = [];
    if (targetClass) {
      const roster = await this.getClassWithRoster(targetClass.id, teacherId);
      members = (roster?.members || []).map((m) => ({
        studentId: m.studentId,
        studentName: m.studentName,
        studentEmail: m.studentEmail,
      }));
    } else {
      const enrolled = await this.listTeacherEnrolledStudents(teacherId);
      members = enrolled.map((s) => ({
        studentId: s.id,
        studentName: s.name,
        studentEmail: s.email,
      }));
    }

    const submissionsRaw = await store.listTeacherSubmissions(teacherId);
    const submissions: ClassSubmissionMetric[] = submissionsRaw.map((s) => ({
      studentId: String(s.student_id),
      studentName: String(s.student_name),
      studentEmail: String(s.student_email),
      percentage: Number(s.percentage || 0),
      passed: Boolean(s.passed),
      status: s.attempt_status as 'submitted' | 'evaluated',
    }));

    const analytics = computeTeacherClassAnalytics({
      members,
      submissions,
      expectedTotalAssignments: members.length,
    });

    return {
      selectedClass: targetClass,
      classes,
      analytics,
    };
  }

  // =========================================================================
  // STUDENT PROGRESS & RECOMMENDATIONS
  // =========================================================================
  async getStudentProgress(studentId: string): Promise<StudentProgressSummary> {
    const [examEntries, practiceQuizzes] = await Promise.all([
      store.listPublishedExamsForStudent(studentId),
      store.listPracticeQuizzesForStudent(studentId),
    ]);

    let questionAnswersByAttempt = new Map<
      string,
      Array<{ topic: string; marks: number; marksAwarded: number | null; isCorrect: boolean | null; studentAnswer: string }>
    >();

    const completedAttemptIds = examEntries
      .filter((e) => e.attempt && (e.attempt.status === 'submitted' || e.attempt.status === 'evaluated'))
      .map((e) => e.attempt!.id);

    if (completedAttemptIds.length > 0) {
      for (const attId of completedAttemptIds) {
        const detailWrap = await store.getResultDetail(attId);
        if (detailWrap) {
          questionAnswersByAttempt.set(
            attId,
            detailWrap.detail.questions.map((q) => ({
              topic: q.topic || detailWrap.detail.subject || 'General',
              marks: q.marks,
              marksAwarded: q.marksAwarded,
              isCorrect: q.isCorrect,
              studentAnswer: q.studentAnswer,
            }))
          );
        }
      }
    }

    const examInputs: StudentProgressExamInput[] = examEntries.map((entry) => ({
      examId: entry.exam.id,
      examTitle: entry.exam.title,
      subject: entry.exam.subject,
      attemptId: entry.attempt?.id ?? null,
      attemptStatus: entry.attempt?.status ?? null,
      startedAt: entry.attempt?.started_at ?? null,
      submittedAt: entry.attempt?.submitted_at ?? null,
      result: entry.result
        ? {
            totalScore: Number(entry.result.total_score),
            totalMarks: Number(entry.result.total_marks),
            percentage: Number(entry.result.percentage),
            passed: Boolean(entry.result.passed),
            status: entry.result.status as 'pending_evaluation' | 'evaluated',
          }
        : null,
      questionAnswers: entry.attempt ? questionAnswersByAttempt.get(entry.attempt.id) || [] : [],
    }));

    const practiceAttemptsRaw = await store.listRecentPracticeAttempts(studentId, 40);
    const quizTopicMap = new Map(practiceQuizzes.map((q) => [q.title, q.topic]));
    const practiceInputs: StudentProgressPracticeInput[] = practiceAttemptsRaw.map((pa) => ({
      id: pa.id,
      quizTitle: pa.quizTitle,
      topic: quizTopicMap.get(pa.quizTitle) || 'Practice Study',
      score: pa.score,
      totalMarks: pa.totalMarks,
      percentage: pa.percentage,
      completedAt: pa.completedAt,
    }));

    return computeStudentProgressOverview({
      exams: examInputs,
      practiceAttempts: practiceInputs,
    });
  }

  // =========================================================================
  // ADMIN CONSOLE QUERIES & GOVERNANCE
  // =========================================================================
  async getDatabaseOverview(): Promise<{
    provider: 'sqlite' | 'supabase';
    tables: Array<{ name: string; rows: number }>;
  }> {
    const tableNames = [
      'users',
      'profiles',
      'teacher_profiles',
      'classes',
      'class_members',
      'documents',
      'practice_quizzes',
      'practice_attempts',
      'question_bank',
      'exams',
      'exam_assignments',
      'questions',
      'exam_attempts',
      'results',
      'evaluations',
      'activity_logs',
      'request_logs',
      'admin_audit_logs',
      'platform_settings',
    ];

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const tables = await Promise.all(
        tableNames.map(async (name) => {
          try {
            const { count } = await sb.from(name).select('*', { count: 'exact', head: true });
            return { name, rows: count || 0 };
          } catch {
            return { name, rows: 0 };
          }
        })
      );
      return { provider: 'supabase', tables };
    }

    const db = store.getSql();
    const tables = tableNames.map((name) => {
      try {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number } | undefined;
        return { name, rows: Number(row?.c || 0) };
      } catch {
        return { name, rows: 0 };
      }
    });
    return { provider: 'sqlite', tables };
  }

  async getAdminOverview() {
    const [usage, settings, database, recentAuditLogs, results] = await Promise.all([
      store.getUsageOverview(),
      this.getPlatformSettings(),
      this.getDatabaseOverview(),
      this.listAdminAuditLogs(15),
      this.adminListResults(),
    ]);

    const tableCountMap = new Map(database.tables.map((t) => [t.name, t.rows]));
    const users = usage.users;
    const totalStudents = users.filter((u) => u.role === 'student').length;
    const totalTeachers = users.filter((u) => u.role === 'teacher').length;
    const pendingTeachers = users.filter(
      (u) => u.role === 'teacher' && (u.teacherProfile?.approvalStatus || 'pending') !== 'approved'
    ).length;
    const totalAdmins = users.filter((u) => u.role === 'admin').length;

    const evaluatedResults = results.filter((r) => r.status === 'evaluated');
    const avgPlatformScore =
      evaluatedResults.length > 0
        ? Math.round(
            (evaluatedResults.reduce((acc, r) => acc + Number(r.percentage || 0), 0) /
              evaluatedResults.length) *
              10
          ) / 10
        : null;
    const platformPassRate =
      evaluatedResults.length > 0
        ? Math.round(
            (evaluatedResults.filter((r) => Boolean(r.passed)).length / evaluatedResults.length) * 1000
          ) / 10
        : null;

    return {
      dbProvider: store.provider,
      summary: {
        totalUsers: users.length,
        totalStudents,
        totalTeachers,
        pendingTeachers,
        totalAdmins,
        totalClasses: tableCountMap.get('classes') || 0,
        totalExams: tableCountMap.get('exams') || 0,
        totalAttempts: tableCountMap.get('exam_attempts') || 0,
        totalResults: tableCountMap.get('results') || 0,
        totalDocuments: usage.summary.totalDocuments,
        totalAiGenerations: usage.summary.totalAiGenerations,
        totalRequests: usage.summary.totalRequests,
        avgPlatformScore,
        platformPassRate,
      },
      settings,
      database,
      recentAuditLogs,
      recentRequests: usage.logs.slice(0, 20),
    };
  }

  async adminListUsers(filters: {
    role?: string;
    status?: string;
    search?: string;
  }): Promise<UserProfile[]> {
    const all = await store.listAllUsers();
    const roleFilter = (filters.role || 'all').toLowerCase();
    const statusFilter = (filters.status || 'all').toLowerCase();
    const search = (filters.search || '').trim().toLowerCase();

    return all.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && (u.accountStatus || 'active') !== statusFilter) return false;
      if (search) {
        const hay = `${u.name} ${u.email} ${u.institution || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  async adminCreateUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    institution?: string;
    subject?: string;
    bio?: string;
    approvalStatus?: TeacherApprovalStatus;
    adminId: string;
  }): Promise<{ ok: true; user: UserProfile } | { ok: false; status: number; error: string }> {
    const cleanEmail = input.email.trim().toLowerCase();
    const existing = await store.findUserByEmail(cleanEmail);
    if (existing) {
      return { ok: false, status: 409, error: 'An account with this email already exists.' };
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const approvalStatus: TeacherApprovalStatus = input.approvalStatus || 'approved';

    await store.createUser(
      {
        id: userId,
        name: input.name.trim().slice(0, 80),
        email: cleanEmail,
        password_hash: input.passwordHash,
        role: input.role,
        institution: (input.institution || '').trim().slice(0, 120),
        account_status: 'active',
        created_at: now,
      },
      input.role === 'teacher'
        ? {
            subject: (input.subject || '').trim().slice(0, 120),
            bio: (input.bio || '').trim().slice(0, 800),
            approvalStatus,
            approvedBy: approvalStatus === 'approved' ? input.adminId : null,
          }
        : undefined
    );

    await this.recordAdminAuditLog({
      adminId: input.adminId,
      action: 'admin_create_user',
      targetType: 'user',
      targetId: userId,
      details: `Created ${input.role} user ${cleanEmail}`,
    });

    const user = await store.findUserById(userId);
    if (!user) {
      return { ok: false, status: 500, error: 'Failed to load created user.' };
    }
    return { ok: true, user };
  }

  async adminUpdateUser(
    targetId: string,
    patch: {
      name?: string;
      role?: UserRole;
      accountStatus?: AccountStatus;
      institution?: string;
      subject?: string;
      bio?: string;
      approvalStatus?: TeacherApprovalStatus;
      rejectionReason?: string;
    },
    adminId: string
  ): Promise<{ ok: true; user: UserProfile } | { ok: false; status: number; error: string }> {
    const existing = await store.findUserById(targetId);
    if (!existing) {
      return { ok: false, status: 404, error: 'User not found.' };
    }

    if (targetId === adminId) {
      if (patch.role && patch.role !== 'admin') {
        return { ok: false, status: 400, error: 'You cannot demote your own administrator role.' };
      }
      if (patch.accountStatus && patch.accountStatus !== 'active') {
        return { ok: false, status: 400, error: 'You cannot suspend or deactivate your own account.' };
      }
    }

    if (
      existing.role === 'admin' &&
      ((patch.role && patch.role !== 'admin') || (patch.accountStatus && patch.accountStatus !== 'active'))
    ) {
      const adminCount = await this.countAdminUsers();
      if (adminCount <= 1) {
        return { ok: false, status: 400, error: 'At least one active administrator account must remain.' };
      }
    }

    const name = typeof patch.name === 'string' && patch.name.trim().length >= 2 ? patch.name.trim().slice(0, 80) : existing.name;
    const role: UserRole = patch.role || existing.role;
    const accountStatus: AccountStatus = patch.accountStatus || existing.accountStatus || 'active';
    const institution =
      typeof patch.institution === 'string' ? patch.institution.trim().slice(0, 120) : existing.institution || '';
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      await sb
        .from('users')
        .update({ name, role, account_status: accountStatus, institution, updated_at: now })
        .eq('id', targetId);
      await sb
        .from('profiles')
        .update({ full_name: name, role, account_status: accountStatus, institution, updated_at: now })
        .eq('id', targetId);

      if (role === 'teacher') {
        const approvalStatus = patch.approvalStatus || existing.teacherProfile?.approvalStatus || 'approved';
        await sb.from('teacher_profiles').upsert(
          {
            id: `tp_${targetId}`,
            user_id: targetId,
            subject:
              typeof patch.subject === 'string'
                ? patch.subject.trim().slice(0, 120)
                : existing.teacherProfile?.subject || '',
            institution,
            bio:
              typeof patch.bio === 'string'
                ? patch.bio.trim().slice(0, 800)
                : existing.teacherProfile?.bio || '',
            approval_status: approvalStatus,
            approved_by: approvalStatus === 'approved' ? adminId : existing.teacherProfile?.approvedBy || null,
            approved_at: approvalStatus === 'approved' ? existing.teacherProfile?.approvedAt || now : null,
            rejection_reason:
              typeof patch.rejectionReason === 'string'
                ? patch.rejectionReason.trim().slice(0, 300)
                : existing.teacherProfile?.rejectionReason || '',
            created_at: existing.teacherProfile?.createdAt || now,
            updated_at: now,
          },
          { onConflict: 'user_id' }
        );
      }
    } else {
      const db = store.getSql();
      db.prepare('UPDATE users SET name = ?, role = ?, account_status = ?, institution = ?, updated_at = ? WHERE id = ?').run(
        name,
        role,
        accountStatus,
        institution,
        now,
        targetId
      );
      db.prepare('UPDATE profiles SET full_name = ?, role = ?, account_status = ?, institution = ?, updated_at = ? WHERE id = ?').run(
        name,
        role,
        accountStatus,
        institution,
        now,
        targetId
      );
      if (role === 'teacher') {
        const approvalStatus = patch.approvalStatus || existing.teacherProfile?.approvalStatus || 'approved';
        const subject =
          typeof patch.subject === 'string'
            ? patch.subject.trim().slice(0, 120)
            : existing.teacherProfile?.subject || '';
        const bio =
          typeof patch.bio === 'string'
            ? patch.bio.trim().slice(0, 800)
            : existing.teacherProfile?.bio || '';
        const rejectionReason =
          typeof patch.rejectionReason === 'string'
            ? patch.rejectionReason.trim().slice(0, 300)
            : existing.teacherProfile?.rejectionReason || '';
        db.prepare(
          `INSERT INTO teacher_profiles (id, user_id, subject, institution, bio, approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             subject = excluded.subject,
             institution = excluded.institution,
             bio = excluded.bio,
             approval_status = excluded.approval_status,
             approved_by = excluded.approved_by,
             approved_at = excluded.approved_at,
             rejection_reason = excluded.rejection_reason,
             updated_at = excluded.updated_at`
        ).run(
          `tp_${targetId}`,
          targetId,
          subject,
          institution,
          bio,
          approvalStatus,
          approvalStatus === 'approved' ? adminId : existing.teacherProfile?.approvedBy || null,
          approvalStatus === 'approved' ? existing.teacherProfile?.approvedAt || now : null,
          rejectionReason,
          existing.teacherProfile?.createdAt || now,
          now
        );
      }
    }

    await this.recordAdminAuditLog({
      adminId,
      action: 'admin_update_user',
      targetType: 'user',
      targetId,
      details: `Updated user ${existing.email} (role=${role}, status=${accountStatus})`,
    });

    const updated = await store.findUserById(targetId);
    if (!updated) {
      return { ok: false, status: 500, error: 'Failed to reload updated user.' };
    }
    return { ok: true, user: updated };
  }

  async updateTeacherApproval(
    teacherId: string,
    approvalStatus: TeacherApprovalStatus,
    adminId: string,
    rejectionReason = ''
  ): Promise<{ ok: true; user: UserProfile } | { ok: false; status: number; error: string }> {
    const existing = await store.findUserById(teacherId);
    if (!existing || existing.role !== 'teacher') {
      return { ok: false, status: 404, error: 'Teacher account not found.' };
    }

    const now = new Date().toISOString();
    const cleanReason = approvalStatus === 'rejected' ? rejectionReason.trim().slice(0, 300) : '';

    if (store.provider === 'supabase') {
      await store.getSupa().from('teacher_profiles').upsert(
        {
          id: `tp_${teacherId}`,
          user_id: teacherId,
          subject: existing.teacherProfile?.subject || '',
          institution: existing.institution || '',
          bio: existing.teacherProfile?.bio || '',
          approval_status: approvalStatus,
          approved_by: adminId,
          approved_at: approvalStatus === 'approved' ? now : null,
          rejection_reason: cleanReason,
          created_at: existing.teacherProfile?.createdAt || now,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );
    } else {
      store
        .getSql()
        .prepare(
          `INSERT INTO teacher_profiles (id, user_id, subject, institution, bio, approval_status, approved_by, approved_at, rejection_reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             approval_status = excluded.approval_status,
             approved_by = excluded.approved_by,
             approved_at = excluded.approved_at,
             rejection_reason = excluded.rejection_reason,
             updated_at = excluded.updated_at`
        )
        .run(
          `tp_${teacherId}`,
          teacherId,
          existing.teacherProfile?.subject || '',
          existing.institution || '',
          existing.teacherProfile?.bio || '',
          approvalStatus,
          adminId,
          approvalStatus === 'approved' ? now : null,
          cleanReason,
          existing.teacherProfile?.createdAt || now,
          now
        );
    }

    await this.recordAdminAuditLog({
      adminId,
      action: `teacher_${approvalStatus}`,
      targetType: 'teacher_profile',
      targetId: teacherId,
      details: `${approvalStatus === 'approved' ? 'Approved' : approvalStatus === 'rejected' ? 'Rejected' : 'Reset'} teacher ${existing.email}${cleanReason ? `: ${cleanReason}` : ''}`,
    });

    const updated = await store.findUserById(teacherId);
    if (!updated) {
      return { ok: false, status: 500, error: 'Failed to reload teacher profile.' };
    }
    return { ok: true, user: updated };
  }

  async adminListClasses(): Promise<ClassRecord[]> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: classes, error } = await sb
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!classes || classes.length === 0) return [];
      const classIds = classes.map((c) => String(c.id));
      const teacherIds = Array.from(new Set(classes.map((c) => String(c.teacher_id))));
      const [{ data: teachers }, { data: members }, { data: asgs }] = await Promise.all([
        sb.from('users').select('id, name').in('id', teacherIds),
        sb.from('class_members').select('class_id').eq('status', 'active').in('class_id', classIds),
        sb.from('exam_assignments').select('class_id, exam_id').in('class_id', classIds),
      ]);
      const tMap = new Map((teachers || []).map((t) => [String(t.id), String(t.name)]));
      const memCount = new Map<string, number>();
      for (const m of members || []) memCount.set(String(m.class_id), (memCount.get(String(m.class_id)) || 0) + 1);
      const exSet = new Map<string, Set<string>>();
      for (const a of asgs || []) {
        const s = exSet.get(String(a.class_id)) || new Set<string>();
        s.add(String(a.exam_id));
        exSet.set(String(a.class_id), s);
      }
      return classes.map((c) => ({
        id: String(c.id),
        teacherId: String(c.teacher_id),
        teacherName: tMap.get(String(c.teacher_id)) || 'Teacher',
        name: String(c.name),
        description: String(c.description || ''),
        subject: String(c.subject || ''),
        enrollmentCode: String(c.enrollment_code),
        status: (c.status as 'active' | 'archived') || 'active',
        memberCount: memCount.get(String(c.id)) || 0,
        assignedExamCount: exSet.get(String(c.id))?.size || 0,
        createdAt: String(c.created_at),
        updatedAt: c.updated_at ? String(c.updated_at) : null,
      }));
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT c.*, u.name as teacher_name,
          (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id AND cm.status = 'active') as member_count,
          (SELECT COUNT(DISTINCT ea.exam_id) FROM exam_assignments ea WHERE ea.class_id = c.id) as assigned_exam_count
         FROM classes c
         LEFT JOIN users u ON u.id = c.teacher_id
         ORDER BY c.created_at DESC`
      )
      .all();

    return rows.map((c) => ({
      id: String(c.id),
      teacherId: String(c.teacher_id),
      teacherName: String(c.teacher_name || 'Teacher'),
      name: String(c.name),
      description: String(c.description || ''),
      subject: String(c.subject || ''),
      enrollmentCode: String(c.enrollment_code),
      status: (c.status as 'active' | 'archived') || 'active',
      memberCount: Number(c.member_count || 0),
      assignedExamCount: Number(c.assigned_exam_count || 0),
      createdAt: String(c.created_at),
      updatedAt: c.updated_at ? String(c.updated_at) : null,
    }));
  }

  async adminListExams(): Promise<Array<OfficialExamSummary & { teacherEmail?: string }>> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: exams, error } = await sb
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!exams || exams.length === 0) return [];
      const examIds = exams.map((e) => String(e.id));
      const teacherIds = Array.from(new Set(exams.map((e) => String(e.teacher_id))));
      const [{ data: teachers }, { data: qs }, { data: atts }] = await Promise.all([
        sb.from('users').select('id, name, email').in('id', teacherIds),
        sb.from('questions').select('exam_id').in('exam_id', examIds),
        sb.from('exam_attempts').select('exam_id, status').in('exam_id', examIds).in('status', ['submitted', 'evaluated']),
      ]);
      const tMap = new Map((teachers || []).map((t) => [String(t.id), { name: String(t.name), email: String(t.email) }]));
      const qCount = new Map<string, number>();
      for (const q of qs || []) qCount.set(String(q.exam_id), (qCount.get(String(q.exam_id)) || 0) + 1);
      const subCount = new Map<string, number>();
      const pendCount = new Map<string, number>();
      for (const a of atts || []) {
        const eid = String(a.exam_id);
        subCount.set(eid, (subCount.get(eid) || 0) + 1);
        if (a.status === 'submitted') pendCount.set(eid, (pendCount.get(eid) || 0) + 1);
      }
      return exams.map((e) => {
        const t = tMap.get(String(e.teacher_id));
        return {
          id: String(e.id),
          teacherId: String(e.teacher_id),
          teacherName: t?.name || 'Teacher',
          teacherEmail: t?.email || '',
          title: String(e.title),
          subject: String(e.subject),
          instructions: String(e.instructions || ''),
          durationMinutes: Number(e.duration_minutes),
          totalMarks: Number(e.total_marks),
          passingMarks: Number(e.passing_marks),
          deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
          status: (e.status as 'draft' | 'published') || 'draft',
          randomizeQuestions: Boolean(e.randomize_questions),
          randomizeOptions: Boolean(e.randomize_options),
          trackTabSwitches: Boolean(e.track_tab_switches),
          warnOnTabLeave: Boolean(e.warn_on_tab_leave),
          requireFullscreen: Boolean(e.require_fullscreen),
          blockCopyPaste: Boolean(e.block_copy_paste),
          maxTabSwitches: Number(e.max_tab_switches ?? 3),
          assignAll: Boolean(e.assign_all),
          questionCount: qCount.get(String(e.id)) || 0,
          submissionCount: subCount.get(String(e.id)) || 0,
          pendingEvaluationCount: pendCount.get(String(e.id)) || 0,
          createdAt: String(e.created_at),
        };
      });
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT e.*, u.name as teacher_name, u.email as teacher_email,
          (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status IN ('submitted', 'evaluated')) as submission_count,
          (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.exam_id = e.id AND ea.status = 'submitted') as pending_count
         FROM exams e
         LEFT JOIN users u ON u.id = e.teacher_id
         ORDER BY e.created_at DESC`
      )
      .all();

    return rows.map((e) => ({
      id: String(e.id),
      teacherId: String(e.teacher_id),
      teacherName: String(e.teacher_name || 'Teacher'),
      teacherEmail: String(e.teacher_email || ''),
      title: String(e.title),
      subject: String(e.subject),
      instructions: String(e.instructions || ''),
      durationMinutes: Number(e.duration_minutes),
      totalMarks: Number(e.total_marks),
      passingMarks: Number(e.passing_marks),
      deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
      status: (e.status as 'draft' | 'published') || 'draft',
      randomizeQuestions: Boolean(e.randomize_questions),
      randomizeOptions: Boolean(e.randomize_options),
      trackTabSwitches: Boolean(e.track_tab_switches),
      warnOnTabLeave: Boolean(e.warn_on_tab_leave),
      requireFullscreen: Boolean(e.require_fullscreen),
      blockCopyPaste: Boolean(e.block_copy_paste),
      maxTabSwitches: Number(e.max_tab_switches ?? 3),
      assignAll: Boolean(e.assign_all),
      questionCount: Number(e.question_count || 0),
      submissionCount: Number(e.submission_count || 0),
      pendingEvaluationCount: Number(e.pending_count || 0),
      createdAt: String(e.created_at),
    }));
  }

  async adminListAttempts() {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: attempts, error } = await sb
        .from('exam_attempts')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      if (!attempts || attempts.length === 0) return [];
      const examIds = Array.from(new Set(attempts.map((a) => String(a.exam_id))));
      const studentIds = Array.from(new Set(attempts.map((a) => String(a.student_id))));
      const [{ data: exams }, { data: students }] = await Promise.all([
        sb.from('exams').select('id, title, subject').in('id', examIds),
        sb.from('users').select('id, name, email').in('id', studentIds),
      ]);
      const eMap = new Map((exams || []).map((e) => [String(e.id), e]));
      const sMap = new Map((students || []).map((s) => [String(s.id), s]));
      return attempts.map((a) => {
        const ex = eMap.get(String(a.exam_id));
        const st = sMap.get(String(a.student_id));
        return {
          id: String(a.id),
          examId: String(a.exam_id),
          examTitle: ex ? String(ex.title) : 'Exam',
          subject: ex ? String(ex.subject) : '',
          studentId: String(a.student_id),
          studentName: st ? String(st.name) : 'Student',
          studentEmail: st ? String(st.email) : '',
          status: String(a.status),
          startedAt: String(a.started_at),
          submittedAt: a.submitted_at ? String(a.submitted_at) : null,
          tabSwitchCount: Number(a.tab_switch_count || 0),
        };
      });
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT ea.*, e.title as exam_title, e.subject, u.name as student_name, u.email as student_email
         FROM exam_attempts ea
         LEFT JOIN exams e ON e.id = ea.exam_id
         LEFT JOIN users u ON u.id = ea.student_id
         ORDER BY ea.started_at DESC
         LIMIT 200`
      )
      .all();

    return rows.map((a) => ({
      id: String(a.id),
      examId: String(a.exam_id),
      examTitle: String(a.exam_title || 'Exam'),
      subject: String(a.subject || ''),
      studentId: String(a.student_id),
      studentName: String(a.student_name || 'Student'),
      studentEmail: String(a.student_email || ''),
      status: String(a.status),
      startedAt: String(a.started_at),
      submittedAt: a.submitted_at ? String(a.submitted_at) : null,
      tabSwitchCount: Number(a.tab_switch_count || 0),
    }));
  }

  async adminListResults() {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: results, error } = await sb
        .from('results')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      if (!results || results.length === 0) return [];
      const examIds = Array.from(new Set(results.map((r) => String(r.exam_id))));
      const studentIds = Array.from(new Set(results.map((r) => String(r.student_id))));
      const [{ data: exams }, { data: students }] = await Promise.all([
        sb.from('exams').select('id, title, subject').in('id', examIds),
        sb.from('users').select('id, name, email').in('id', studentIds),
      ]);
      const eMap = new Map((exams || []).map((e) => [String(e.id), e]));
      const sMap = new Map((students || []).map((s) => [String(s.id), s]));
      return results.map((r) => {
        const ex = eMap.get(String(r.exam_id));
        const st = sMap.get(String(r.student_id));
        return {
          id: String(r.id),
          attemptId: String(r.attempt_id),
          examId: String(r.exam_id),
          examTitle: ex ? String(ex.title) : 'Exam',
          subject: ex ? String(ex.subject) : '',
          studentName: st ? String(st.name) : 'Student',
          studentEmail: st ? String(st.email) : '',
          totalScore: Number(r.total_score || 0),
          totalMarks: Number(r.total_marks || 0),
          percentage: Number(r.percentage || 0),
          passed: Boolean(r.passed),
          status: String(r.status),
          publishedAt: String(r.published_at),
        };
      });
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT r.*, e.title as exam_title, e.subject, u.name as student_name, u.email as student_email
         FROM results r
         LEFT JOIN exams e ON e.id = r.exam_id
         LEFT JOIN users u ON u.id = r.student_id
         ORDER BY r.published_at DESC
         LIMIT 200`
      )
      .all();

    return rows.map((r) => ({
      id: String(r.id),
      attemptId: String(r.attempt_id),
      examId: String(r.exam_id),
      examTitle: String(r.exam_title || 'Exam'),
      subject: String(r.subject || ''),
      studentName: String(r.student_name || 'Student'),
      studentEmail: String(r.student_email || ''),
      totalScore: Number(r.total_score || 0),
      totalMarks: Number(r.total_marks || 0),
      percentage: Number(r.percentage || 0),
      passed: Boolean(r.passed),
      status: String(r.status),
      publishedAt: String(r.published_at),
    }));
  }
}

export const domainStore = new DomainStore();
