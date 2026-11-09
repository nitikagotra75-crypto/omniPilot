import mongoose from "mongoose";

const { Schema } = mongoose;
const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

export const MEMORY_CATEGORIES = ["preference", "project", "instruction", "workflow", "context"];

const stepSchema = new Schema(
  {
    idx: Number, tool: String, args: Schema.Types.Mixed, result: Schema.Types.Mixed,
    ok: Boolean, verified: Boolean, startedAt: Date, finishedAt: Date,
  },
  { _id: false }
);

export const Conversation = model("Conversation", new Schema({ title: String }, { timestamps: true }));
export const Message = model(
  "Message",
  new Schema(
    {
      conversationId: { type: Schema.Types.ObjectId, index: true, required: true },
      role: { type: String, enum: ["user", "assistant"], required: true },
      content: { type: String, required: true },
    },
    { timestamps: true }
  )
);
export const Task = model(
  "Task",
  new Schema(
    {
      conversationId: Schema.Types.ObjectId,
      request: { type: String, required: true },
      status: { type: String, enum: ["running", "completed", "failed", "cancelled"], default: "running" },
      result: String, error: String, finishedAt: Date,
      steps: [stepSchema],
    },
    { timestamps: true }
  )
);
export const ActionLog = model(
  "ActionLog",
  new Schema({ taskId: Schema.Types.ObjectId, tool: String, permission: String, approved: Boolean, summary: String }, { timestamps: true })
);
export const Memory = model(
  "Memory",
  new Schema(
    {
      category: { type: String, enum: MEMORY_CATEGORIES, required: true },
      content: { type: String, required: true, maxlength: 2000 },
      source: { type: String, default: "user" },
    },
    { timestamps: true }
  )
);
export const Setting = model("Setting", new Schema({ key: { type: String, unique: true }, value: Schema.Types.Mixed }));
export const PermissionGrant = model(
  "PermissionGrant",
  new Schema({ permission: { type: String, unique: true }, mode: { type: String, enum: ["allow", "ask", "deny"] } }, { timestamps: true })
);
