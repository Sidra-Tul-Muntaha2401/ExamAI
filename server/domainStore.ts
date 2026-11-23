import crypto from 'node:crypto';
import {
  computeStudentProgressOverview,
  computeTeacherClassAnalytics,
  generateEnrollmentCode,
  normalizeEnrollmentCode,
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
  RequestLogRecord,
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
  // SETTINGS & AUDIT LOGS
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
          ? Math.min(Math.max(0, Math.floor(patch.defaultMaxTabSwitches)), 10)
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
      const sb = store.getSupa();
      await sb.from('platform_settings').upsert(
        entries.map(([key, value]) => ({ key, value, updated_by: adminId, updated_at: now })),
        { onConflict: 'key' }
      );
    } else {
      const db = store.getSql();
      const stmt = db.prepare(
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
      details: JSON.stringify(next),
    });

    return next;
  }

  async recordAdminAuditLog(entry: {
    adminId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details: string;
  }): Promise<void> {
    try {
      const id = `audit_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      if (store.provider === 'supabase') {
        await store.getSupa().from('admin_audit_logs').insert({
          id,
          admin_id: entry.adminId,
          action: entry.action,
          target_type: entry.targetType,
          target_id: entry.targetId,
          details: entry.details.slice(0, 500),
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
        .run(
          id,
          entry.adminId,
          entry.action,
          entry.targetType,
          entry.targetId,
          entry.details.slice(0, 500),
          createdAt
        );
    } catch {
      // Non-blocking audit log
    }
  }

  async listAdminAuditLogs(limit = 100): Promise<AdminAuditLogRecord[]> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: logs, error } = await sb
        .from('admin_audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      const adminIds = Array.from(new Set((logs || []).map((l) => l.admin_id).filter(Boolean).map(String)));
      const { data: admins } =
        adminIds.length > 0
          ? await sb.from('users').select('id, name').in('id', adminIds)
          : { data: [] };
      const adminMap = new Map((admins || []).map((a) => [String(a.id), String(a.name)]));
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
        `SELECT al.*, u.name as admin_name
         FROM admin_audit_logs al
         LEFT JOIN users u ON u.id = al.admin_id
         ORDER BY al.created_at DESC
         LIMIT ?`
      )
      .all(limit);
    return rows.map((l) => ({
      id: String(l.id),
      adminId: l.admin_id ? String(l.admin_id) : null,
      adminName: l.admin_name ? String(l.admin_name) : 'System',
      action: String(l.action),
      targetType: String(l.target_type),
      targetId: String(l.target_id),
      details: String(l.details || ''),
      createdAt: String(l.created_at),
    }));
  }

  // =========================================================================
  // ADMIN BOOTSTRAP, DEMO & PASSWORD RESET
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
      .get() as { c: number };
    return Number(row.c);
  }

  async claimInitialAdmin(input: {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    institution?: string;
    createdAt: string;
  }): Promise<{ ok: true; user: UserProfile } | { ok: false; error: string; status: number }> {
    const cleanEmail = input.email.trim().toLowerCase();
    const adminCount = await this.countAdminUsers();
    if (adminCount > 0) {
      return {
        ok: false,
        error: 'An Admin account already exists. Ask an existing Admin or enter the Admin Setup Secret.',
        status: 403,
      };
    }

    const existing = await store.findUserByEmail(cleanEmail);
    if (existing) {
      return { ok: false, error: 'An account with this email already exists.', status: 409 };
    }

    if (store.provider === 'sqlite') {
      // Atomic check-and-insert under SQLite IMMEDIATE transaction
      const db = store.getSql();
      db.exec('BEGIN IMMEDIATE');
      try {
        const countRow = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
        if (Number(countRow.c) > 0) {
          db.exec('ROLLBACK');
          return {
            ok: false,
            error: 'An Admin account already exists.',
            status: 403,
          };
        }
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
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
      details: `First administrator claimed (${cleanEmail})`,
    });

    const user = (await store.findUserById(input.id))!;
    return { ok: true, user };
  }

  async findOrCreateDemoAdmin(): Promise<UserProfile> {
    const email = 'admin@exampilot.edu';
    const existing = await store.findUserByEmail(email);
    if (existing) {
      const profile = await store.findUserById(existing.id);
      if (profile) return profile;
    }

    const now = new Date().toISOString();
    const id = 'usr_admin_demo';
    await store.createUser({
      id,
      name: 'Alex Morgan (Demo Admin)',
      email,
      password_hash: hashPassword('Admin123!'),
      role: 'admin',
      institution: 'ExamAI Administration',
      account_status: 'active',
      created_at: now,
    });

    await this.recordAdminAuditLog({
      adminId: id,
      action: 'demo_admin_provisioned',
      targetType: 'user',
      targetId: id,
      details: 'Demo Admin account initialized for quick workspace preview',
    });

    return (await store.findUserById(id))!;
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
  // SUPABASE AUTH USER SYNC
  // =========================================================================
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
    let role: UserRole = input.requestedRole || 'student';

    if (role === 'admin') {
      const adminCount = await this.countAdminUsers();
      const configuredSecret = (process.env.ADMIN_BOOTSTRAP_SECRET || '').trim();
      const validSecret =
        configuredSecret.length > 0 &&
        typeof input.setupSecret === 'string' &&
        input.setupSecret.trim() === configuredSecret;
      if (adminCount > 0 && !validSecret) {
        return { error: 'Admin account creation requires a valid Admin Setup Secret.', status: 403 };
      }
    } else if (role === 'teacher' && !settings.allowTeacherRegistration) {
      return { error: 'Teacher registration is currently disabled by administrator.', status: 403 };
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
  // ADMIN CONSOLE OPERATIONS
  // =========================================================================
  async adminListUsers(filters?: {
    role?: string;
    status?: string;
    search?: string;
  }): Promise<UserProfile[]> {
    let users = await store.listAllUsers();
    if (filters?.role && filters.role !== 'all') {
      users = users.filter((u) => u.role === filters.role);
    }
    if (filters?.status && filters.status !== 'all') {
      users = users.filter((u) => (u.accountStatus || 'active') === filters.status);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      users = users.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.institution || '').toLowerCase().includes(q)
      );
    }
    return users;
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
  }): Promise<{ ok: true; user: UserProfile } | { ok: false; error: string; status: number }> {
    const cleanEmail = input.email.trim().toLowerCase();
    const existing = await store.findUserByEmail(cleanEmail);
    if (existing) {
      return { ok: false, error: 'An account with this email already exists.', status: 409 };
    }
    const id = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await store.createUser(
      {
        id,
        name: input.name.trim(),
        email: cleanEmail,
        password_hash: input.passwordHash,
        role: input.role,
        institution: (input.institution || '').trim(),
        account_status: 'active',
        created_at: now,
      },
      input.role === 'teacher'
        ? {
            subject: input.subject || '',
            bio: input.bio || '',
            approvalStatus: input.approvalStatus || 'approved',
            approvedBy: (input.approvalStatus || 'approved') === 'approved' ? input.adminId : null,
          }
        : undefined
    );

    await this.recordAdminAuditLog({
      adminId: input.adminId,
      action: 'admin_create_user',
      targetType: 'user',
      targetId: id,
      details: `Created ${input.role} user ${cleanEmail}`,
    });

    const user = (await store.findUserById(id))!;
    return { ok: true, user };
  }

  async adminUpdateUser(
    targetUserId: string,
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
  ): Promise<{ ok: true; user: UserProfile } | { ok: false; error: string; status: number }> {
    const target = await store.findUserById(targetUserId);
    if (!target) {
      return { ok: false, error: 'User not found.', status: 404 };
    }

    if (targetUserId === adminId && patch.accountStatus && patch.accountStatus !== 'active') {
      return { ok: false, error: 'You cannot suspend or deactivate your own administrator account.', status: 400 };
    }
    if (targetUserId === adminId && patch.role && patch.role !== 'admin') {
      return { ok: false, error: 'You cannot remove your own administrator role.', status: 400 };
    }

    const nextName =
      typeof patch.name === 'string' && patch.name.trim().length >= 2 ? patch.name.trim().slice(0, 80) : target.name;
    const nextRole: UserRole =
      patch.role && ['student', 'teacher', 'admin'].includes(patch.role) ? patch.role : target.role;
    const nextStatus: AccountStatus =
      patch.accountStatus && ['active', 'deactivated', 'suspended'].includes(patch.accountStatus)
        ? patch.accountStatus
        : target.accountStatus || 'active';
    const nextInst =
      typeof patch.institution === 'string' ? patch.institution.trim().slice(0, 120) : target.institution || '';
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      await sb
        .from('users')
        .update({ name: nextName, role: nextRole, account_status: nextStatus, institution: nextInst, updated_at: now })
        .eq('id', targetUserId);
      await sb
        .from('profiles')
        .update({ full_name: nextName, role: nextRole, account_status: nextStatus, institution: nextInst, updated_at: now })
        .eq('id', targetUserId);
      if (nextRole === 'teacher') {
        await sb.from('teacher_profiles').upsert(
          {
            id: `tp_${targetUserId}`,
            user_id: targetUserId,
            subject: patch.subject ?? target.teacherProfile?.subject ?? '',
            institution: nextInst,
            bio: patch.bio ?? target.teacherProfile?.bio ?? '',
            approval_status: patch.approvalStatus ?? target.teacherProfile?.approvalStatus ?? 'approved',
            approved_by:
              (patch.approvalStatus ?? target.teacherProfile?.approvalStatus) === 'approved' ? adminId : null,
            approved_at:
              (patch.approvalStatus ?? target.teacherProfile?.approvalStatus) === 'approved' ? now : null,
            rejection_reason: patch.rejectionReason ?? target.teacherProfile?.rejectionReason ?? '',
            created_at: target.teacherProfile?.createdAt || now,
            updated_at: now,
          },
          { onConflict: 'user_id' }
        );
      }
      if (nextStatus !== 'active') {
        await sb.from('sessions').delete().eq('user_id', targetUserId);
      }
    } else {
      const db = store.getSql();
      db.prepare('UPDATE users SET name = ?, role = ?, account_status = ?, institution = ?, updated_at = ? WHERE id = ?').run(
        nextName,
        nextRole,
        nextStatus,
        nextInst,
        now,
        targetUserId
      );
      db.prepare('UPDATE profiles SET full_name = ?, role = ?, account_status = ?, institution = ?, updated_at = ? WHERE id = ?').run(
        nextName,
        nextRole,
        nextStatus,
        nextInst,
        now,
        targetUserId
      );
      if (nextRole === 'teacher') {
        const approvalStatus = patch.approvalStatus ?? target.teacherProfile?.approvalStatus ?? 'approved';
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
          `tp_${targetUserId}`,
          targetUserId,
          patch.subject ?? target.teacherProfile?.subject ?? '',
          nextInst,
          patch.bio ?? target.teacherProfile?.bio ?? '',
          approvalStatus,
          approvalStatus === 'approved' ? adminId : null,
          approvalStatus === 'approved' ? now : null,
          patch.rejectionReason ?? target.teacherProfile?.rejectionReason ?? '',
          target.teacherProfile?.createdAt || now,
          now
        );
      }
      if (nextStatus !== 'active') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
      }
    }

    await this.recordAdminAuditLog({
      adminId,
      action: 'admin_update_user',
      targetType: 'user',
      targetId: targetUserId,
      details: `Updated user ${target.email} (role=${nextRole}, status=${nextStatus})`,
    });

    const updated = (await store.findUserById(targetUserId))!;
    return { ok: true, user: updated };
  }

  async updateTeacherApproval(
    teacherUserId: string,
    approvalStatus: TeacherApprovalStatus,
    adminId: string,
    rejectionReason = ''
  ): Promise<{ ok: true; user: UserProfile } | { ok: false; error: string; status: number }> {
    const user = await store.findUserById(teacherUserId);
    if (!user || user.role !== 'teacher') {
      return { ok: false, error: 'Teacher account not found.', status: 404 };
    }
    const now = new Date().toISOString();

    if (store.provider === 'supabase') {
      await store.getSupa().from('teacher_profiles').upsert(
        {
          id: `tp_${teacherUserId}`,
          user_id: teacherUserId,
          subject: user.teacherProfile?.subject || '',
          institution: user.institution || '',
          bio: user.teacherProfile?.bio || '',
          approval_status: approvalStatus,
          approved_by: approvalStatus === 'approved' ? adminId : null,
          approved_at: approvalStatus === 'approved' ? now : null,
          rejection_reason: approvalStatus === 'rejected' ? rejectionReason.trim() : '',
          created_at: user.teacherProfile?.createdAt || now,
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
          `tp_${teacherUserId}`,
          teacherUserId,
          user.teacherProfile?.subject || '',
          user.institution || '',
          user.teacherProfile?.bio || '',
          approvalStatus,
          approvalStatus === 'approved' ? adminId : null,
          approvalStatus === 'approved' ? now : null,
          approvalStatus === 'rejected' ? rejectionReason.trim() : '',
          user.teacherProfile?.createdAt || now,
          now
        );
    }

    await this.recordAdminAuditLog({
      adminId,
      action: `teacher_approval_${approvalStatus}`,
      targetType: 'teacher_profile',
      targetId: teacherUserId,
      details: `${user.email} -> ${approvalStatus}${rejectionReason ? `: ${rejectionReason}` : ''}`,
    });

    const updated = (await store.findUserById(teacherUserId))!;
    return { ok: true, user: updated };
  }

  async adminListClasses(): Promise<ClassRecord[]> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: classes, error } = await sb.from('classes').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!classes || classes.length === 0) return [];
      const tIds = Array.from(new Set(classes.map((c) => String(c.teacher_id))));
      const cIds = classes.map((c) => String(c.id));
      const [{ data: teachers }, { data: members }, { data: asgs }] = await Promise.all([
        sb.from('users').select('id, name').in('id', tIds),
        sb.from('class_members').select('class_id').eq('status', 'active').in('class_id', cIds),
        sb.from('exam_assignments').select('class_id, exam_id').in('class_id', cIds),
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
          (SELECT COUNT(*) FROM class_members cm WHERE cm.class_id = c.id AND cm.status = 'active') as member_count,
          (SELECT COUNT(DISTINCT ea.exam_id) FROM exam_assignments ea WHERE ea.class_id = c.id) as assigned_exam_count
         FROM classes c
         JOIN users u ON u.id = c.teacher_id
         ORDER BY c.created_at DESC`
      )
      .all();

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

  async adminListExams(): Promise<Array<OfficialExamSummary & { teacherEmail?: string }>> {
    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const { data: exams, error } = await sb.from('exams').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      if (!exams || exams.length === 0) return [];
      const tIds = Array.from(new Set(exams.map((e) => String(e.teacher_id))));
      const eIds = exams.map((e) => String(e.id));
      const [{ data: teachers }, { data: qs }, { data: atts }] = await Promise.all([
        sb.from('users').select('id, name, email').in('id', tIds),
        sb.from('questions').select('exam_id').in('exam_id', eIds),
        sb.from('exam_attempts').select('exam_id, status').in('exam_id', eIds),
      ]);
      const tMap = new Map((teachers || []).map((t) => [String(t.id), t]));
      const qCounts = new Map<string, number>();
      for (const q of qs || []) qCounts.set(String(q.exam_id), (qCounts.get(String(q.exam_id)) || 0) + 1);
      const subCounts = new Map<string, number>();
      const pendCounts = new Map<string, number>();
      for (const a of atts || []) {
        const eid = String(a.exam_id);
        if (a.status === 'submitted' || a.status === 'evaluated') subCounts.set(eid, (subCounts.get(eid) || 0) + 1);
        if (a.status === 'submitted') pendCounts.set(eid, (pendCounts.get(eid) || 0) + 1);
      }
      return exams.map((e) => {
        const t = tMap.get(String(e.teacher_id));
        return {
          id: String(e.id),
          teacherId: String(e.teacher_id),
          teacherName: t ? String(t.name) : 'Instructor',
          teacherEmail: t ? String(t.email) : '',
          title: String(e.title),
          subject: String(e.subject),
          instructions: String(e.instructions),
          durationMinutes: Number(e.duration_minutes),
          totalMarks: Number(e.total_marks),
          passingMarks: Number(e.passing_marks),
          deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
          status: e.status as 'draft' | 'published',
          randomizeQuestions: Boolean(e.randomize_questions),
          randomizeOptions: Boolean(e.randomize_options),
          trackTabSwitches: Boolean(e.track_tab_switches),
          warnOnTabLeave: Boolean(e.warn_on_tab_leave),
          requireFullscreen: Boolean(e.require_fullscreen),
          blockCopyPaste: Boolean(e.block_copy_paste),
          maxTabSwitches: Number(e.max_tab_switches || 3),
          assignAll: Boolean(e.assign_all),
          questionCount: qCounts.get(String(e.id)) || 0,
          submissionCount: subCounts.get(String(e.id)) || 0,
          pendingEvaluationCount: pendCounts.get(String(e.id)) || 0,
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
         JOIN users u ON u.id = e.teacher_id
         ORDER BY e.created_at DESC`
      )
      .all();

    return rows.map((e) => ({
      id: String(e.id),
      teacherId: String(e.teacher_id),
      teacherName: String(e.teacher_name || 'Instructor'),
      teacherEmail: String(e.teacher_email || ''),
      title: String(e.title),
      subject: String(e.subject),
      instructions: String(e.instructions),
      durationMinutes: Number(e.duration_minutes),
      totalMarks: Number(e.total_marks),
      passingMarks: Number(e.passing_marks),
      deadlineAt: e.deadline_at ? String(e.deadline_at) : null,
      status: e.status as 'draft' | 'published',
      randomizeQuestions: Boolean(e.randomize_questions),
      randomizeOptions: Boolean(e.randomize_options),
      trackTabSwitches: Boolean(e.track_tab_switches),
      warnOnTabLeave: Boolean(e.warn_on_tab_leave),
      requireFullscreen: Boolean(e.require_fullscreen),
      blockCopyPaste: Boolean(e.block_copy_paste),
      maxTabSwitches: Number(e.max_tab_switches || 3),
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
      const exMap = new Map((exams || []).map((e) => [String(e.id), e]));
      const stMap = new Map((students || []).map((s) => [String(s.id), s]));
      return attempts.map((a) => {
        const ex = exMap.get(String(a.exam_id));
        const st = stMap.get(String(a.student_id));
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
          focusLossCount: Number(a.focus_loss_count || 0),
        };
      });
    }

    const rows = store
      .getSql()
      .prepare(
        `SELECT ea.*, e.title as exam_title, e.subject, u.name as student_name, u.email as student_email
         FROM exam_attempts ea
         JOIN exams e ON e.id = ea.exam_id
         JOIN users u ON u.id = ea.student_id
         ORDER BY ea.started_at DESC
         LIMIT 200`
      )
      .all();

    return rows.map((a) => ({
      id: String(a.id),
      examId: String(a.exam_id),
      examTitle: String(a.exam_title),
      subject: String(a.subject),
      studentId: String(a.student_id),
      studentName: String(a.student_name),
      studentEmail: String(a.student_email),
      status: String(a.status),
      startedAt: String(a.started_at),
      submittedAt: a.submitted_at ? String(a.submitted_at) : null,
      tabSwitchCount: Number(a.tab_switch_count || 0),
      focusLossCount: Number(a.focus_loss_count || 0),
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
      const exMap = new Map((exams || []).map((e) => [String(e.id), e]));
      const stMap = new Map((students || []).map((s) => [String(s.id), s]));
      return results.map((r) => {
        const ex = exMap.get(String(r.exam_id));
        const st = stMap.get(String(r.student_id));
        return {
          id: String(r.id),
          attemptId: String(r.attempt_id),
          examId: String(r.exam_id),
          examTitle: ex ? String(ex.title) : 'Exam',
          subject: ex ? String(ex.subject) : '',
          studentId: String(r.student_id),
          studentName: st ? String(st.name) : 'Student',
          studentEmail: st ? String(st.email) : '',
          objectiveScore: Number(r.objective_score),
          descriptiveScore: Number(r.descriptive_score),
          totalScore: Number(r.total_score),
          totalMarks: Number(r.total_marks),
          percentage: Number(r.percentage),
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
         JOIN exams e ON e.id = r.exam_id
         JOIN users u ON u.id = r.student_id
         ORDER BY r.published_at DESC
         LIMIT 200`
      )
      .all();

    return rows.map((r) => ({
      id: String(r.id),
      attemptId: String(r.attempt_id),
      examId: String(r.exam_id),
      examTitle: String(r.exam_title),
      subject: String(r.subject),
      studentId: String(r.student_id),
      studentName: String(r.student_name),
      studentEmail: String(r.student_email),
      objectiveScore: Number(r.objective_score),
      descriptiveScore: Number(r.descriptive_score),
      totalScore: Number(r.total_score),
      totalMarks: Number(r.total_marks),
      percentage: Number(r.percentage),
      passed: Boolean(r.passed),
      status: String(r.status),
      publishedAt: String(r.published_at),
    }));
  }

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
      'questions',
      'exam_assignments',
      'exam_attempts',
      'student_answers',
      'results',
      'evaluations',
      'activity_logs',
      'request_logs',
      'admin_audit_logs',
      'platform_settings',
    ];

    if (store.provider === 'supabase') {
      const sb = store.getSupa();
      const counts = await Promise.all(
        tableNames.map(async (name) => {
          const { count } = await sb.from(name).select('id', { count: 'exact', head: true });
          return { name, rows: count || 0 };
        })
      );
      return { provider: 'supabase', tables: counts };
    }

    const db = store.getSql();
    const tables = tableNames.map((name) => {
      try {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${name}`).get() as { c: number };
        return { name, rows: Number(row.c) };
      } catch {
        return { name, rows: 0 };
      }
    });
    return { provider: 'sqlite', tables };
  }

  async getAdminOverview() {
    const [users, classes, exams, attempts, results, usage, auditLogs, settings, dbOverview] =
      await Promise.all([
        this.adminListUsers(),
        this.adminListClasses(),
        this.adminListExams(),
        this.adminListAttempts(),
        this.adminListResults(),
        store.getUsageOverview(),
        this.listAdminAuditLogs(60),
        this.getPlatformSettings(),
        this.getDatabaseOverview(),
      ]);

    const evaluatedResults = results.filter((r) => r.status === 'evaluated');
    const avgPlatformScore =
      evaluatedResults.length > 0
        ? Math.round(
            (evaluatedResults.reduce((acc, r) => acc + r.percentage, 0) / evaluatedResults.length) * 10
          ) / 10
        : null;
    const passCount = evaluatedResults.filter((r) => r.passed).length;
    const platformPassRate =
      evaluatedResults.length > 0 ? Math.round((passCount / evaluatedResults.length) * 1000) / 10 : null;

    return {
      dbProvider: store.provider,
      summary: {
        totalUsers: users.length,
        totalStudents: users.filter((u) => u.role === 'student').length,
        totalTeachers: users.filter((u) => u.role === 'teacher').length,
        pendingTeachers: users.filter(
          (u) => u.role === 'teacher' && u.teacherProfile?.approvalStatus === 'pending'
        ).length,
        totalAdmins: users.filter((u) => u.role === 'admin').length,
        totalClasses: classes.length,
        totalExams: exams.length,
        totalAttempts: attempts.length,
        totalResults: results.length,
        totalDocuments: usage.summary.totalDocuments,
        totalAiGenerations: usage.summary.totalAiGenerations,
        totalRequests: usage.summary.totalRequests,
        avgPlatformScore,
        platformPassRate,
      },
      settings,
      database: dbOverview,
      recentAuditLogs: auditLogs.slice(0, 20),
      recentRequests: usage.logs.slice(0, 50) as RequestLogRecord[],
    };
  }
}

export const domainStore = new DomainStore();
