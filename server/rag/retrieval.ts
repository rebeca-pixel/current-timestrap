import { pool } from "../db";
import { generateEmbedding } from "./ingest";

export interface RetrievalFilter {
  source_db?: string;
  data_type?: string;     // Added to filter by data type (e.g. company_policy)
  employee_id?: string;   // User's UUID in Timestrap
  employee_code?: string; // User's Employee Code (e.g. E0047)
  role?: string;          // User's role (employee, manager, hr, admin)
}

export async function retrieveContext(
  query: string,
  filter: RetrievalFilter,
  limit: number = 5
): Promise<string[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const conditions: string[] = [];
    const params: any[] = [embeddingStr];

    // 1. Filter by source_db if provided
    if (filter.source_db) {
      params.push(filter.source_db);
      conditions.push(`metadata->>'source_db' = $${params.length}`);
    }

    // Filter by data_type if provided
    if (filter.data_type) {
      params.push(filter.data_type);
      conditions.push(`metadata->>'data_type' = $${params.length}`);
    }

    // 2. Security Role Filter
    if (filter.role === "employee") {
      if (filter.data_type === "company_policy") {
        conditions.push(`metadata->'role_access' ? 'employee'`);
      } else if (filter.employee_id) {
        params.push(filter.employee_id);
        conditions.push(`(metadata->>'employee_id' = $${params.length} OR metadata->'role_access' ? 'employee')`);
      } else {
        conditions.push(`metadata->'role_access' ? 'employee'`);
      }
    } else if (filter.role === "manager" || filter.role === "hr" || filter.role === "admin") {
      // see everything — no filter
    } else {
      conditions.push(`1=0`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);
    const limitParamIndex = params.length;

    const sql = `
      SELECT content, (embedding <=> $1::vector) as distance
      FROM document_embeddings
      ${whereClause}
      ORDER BY distance ASC
      LIMIT $${limitParamIndex}
    `;

    const res = await pool.query(sql, params);
    console.log("[RAG] Query:", query);
    console.log("[RAG] Results:", res.rows.length, "chunks");
    console.log("[RAG] First result:", res.rows[0]?.content?.slice(0, 100));
    return res.rows.map((row) => row.content);
  } catch (error: any) {
    console.error("Error retrieving context:", error.message);
    return [];
  }
}
