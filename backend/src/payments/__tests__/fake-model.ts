import { Types } from 'mongoose';

/**
 * Tiny in-memory stand-in for a Mongoose Model, supporting only what the
 * payments module uses: equality / $ne / $in / $nin filters, $set / $unset /
 * $inc updates, sort by createdAt, and unique indexes (incl. partial) that
 * throw a duplicate-key error with code 11000 like MongoDB does.
 */
type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type Filter = Record<string, unknown>;

export interface UniqueIndex {
  fields: string[];
  partial?: Filter;
  sparse?: boolean;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) {
    const sa = idString(a);
    return sa !== null && sa === idString(b);
  }
  return a === b;
}

function idString(x: unknown): string | null {
  if (x instanceof Types.ObjectId) return x.toHexString();
  return typeof x === 'string' ? x : null;
}

function matchValue(actual: unknown, cond: unknown): boolean {
  if (
    cond !== null &&
    typeof cond === 'object' &&
    !(cond instanceof Types.ObjectId) &&
    !(cond instanceof Date)
  ) {
    const ops = cond as Record<string, unknown>;
    return Object.entries(ops).every(([op, v]) => {
      switch (op) {
        case '$ne':
          return !same(actual, v);
        case '$in':
          return (v as unknown[]).some((x) => same(actual, x));
        case '$nin':
          return !(v as unknown[]).some((x) => same(actual, x));
        default:
          throw new Error(`FakeModel: unsupported operator ${op}`);
      }
    });
  }
  return same(actual, cond);
}

function matches(doc: Doc, filter: Filter): boolean {
  return Object.entries(filter).every(([k, cond]) => matchValue(doc[k], cond));
}

export function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error('E11000 duplicate key error'), {
    code: 11000,
  });
}

export class FakeModel {
  docs: Doc[] = [];
  private clock = 0;

  constructor(private readonly uniques: UniqueIndex[] = []) {}

  create(input: Record<string, unknown>): Promise<Doc> {
    const now = new Date(Date.now() + this.clock++); // strictly increasing createdAt
    const doc: Doc = {
      _id: new Types.ObjectId(),
      createdAt: now,
      updatedAt: now,
      ...input,
    } as Doc;
    this.assertUnique(doc);
    this.docs.push(doc);
    return Promise.resolve({ ...doc });
  }

  findOne(
    filter: Filter,
    _projection?: unknown,
    options?: { sort?: Record<string, 1 | -1> },
  ): Promise<Doc | null> {
    let found = this.docs.filter((d) => matches(d, filter));
    if (options?.sort?.createdAt === -1) {
      found = [...found].sort(
        (a, b) =>
          (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      );
    }
    return Promise.resolve(found[0] ? { ...found[0] } : null);
  }

  findById(id: unknown): Promise<Doc | null> {
    return this.findOne({ _id: new Types.ObjectId(String(id)) });
  }

  find(filter: Filter): Promise<Doc[]> {
    return Promise.resolve(
      this.docs.filter((d) => matches(d, filter)).map((d) => ({ ...d })),
    );
  }

  countDocuments(filter: Filter): Promise<number> {
    return Promise.resolve(this.docs.filter((d) => matches(d, filter)).length);
  }

  exists(filter: Filter): Promise<{ _id: Types.ObjectId } | null> {
    const d = this.docs.find((x) => matches(x, filter));
    return Promise.resolve(d ? { _id: d._id } : null);
  }

  findOneAndUpdate(
    filter: Filter,
    update: Record<string, Record<string, unknown>>,
    options?: { returnDocument?: 'before' | 'after' },
  ): Promise<Doc | null> {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return Promise.resolve(null);
    const before = { ...doc };
    this.apply(doc, update);
    return Promise.resolve(
      options?.returnDocument === 'after' ? { ...doc } : before,
    );
  }

  updateOne(
    filter: Filter,
    update: Record<string, Record<string, unknown>>,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
    this.apply(doc, update);
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  }

  deleteOne(filter: Filter): Promise<{ deletedCount: number }> {
    const i = this.docs.findIndex((d) => matches(d, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 });
  }

  /** Test helper: direct read without copying. */
  get(id: unknown): Doc | undefined {
    return this.docs.find((d) => String(d._id) === String(id));
  }

  private apply(doc: Doc, update: Record<string, Record<string, unknown>>) {
    const snapshot = { ...doc };
    for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
    for (const k of Object.keys(update.$unset ?? {})) delete doc[k];
    for (const [k, v] of Object.entries(update.$inc ?? {})) {
      doc[k] = ((doc[k] as number) ?? 0) + (v as number);
    }
    doc.updatedAt = new Date();
    try {
      this.assertUnique(doc);
    } catch (e) {
      Object.keys(doc).forEach((k) => delete doc[k]);
      Object.assign(doc, snapshot);
      throw e;
    }
  }

  private assertUnique(candidate: Doc) {
    for (const idx of this.uniques) {
      if (idx.partial && !matches(candidate, idx.partial)) continue;
      if (idx.sparse && idx.fields.some((f) => candidate[f] == null)) continue;
      const clash = this.docs.some(
        (d) =>
          d._id !== candidate._id &&
          !same(d._id, candidate._id) &&
          (!idx.partial || matches(d, idx.partial)) &&
          idx.fields.every((f) => same(d[f], candidate[f])),
      );
      if (clash) throw duplicateKeyError();
    }
  }
}
