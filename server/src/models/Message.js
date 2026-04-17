const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    content: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000
    },
    attachment: {
      kind: {
        type: String,
        enum: ["image", "video", "audio"]
      },
      mimeType: {
        type: String
      },
      dataUrl: {
        type: String
      },
      name: {
        type: String
      },
      size: {
        type: Number
      }
    },
    reactions: [
      {
        emoji: {
          type: String,
          required: true
        },
        users: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          }
        ]
      }
    ]
  },
  { timestamps: true }
);

messageSchema.pre("validate", function (next) {
  const hasContent = String(this.content || "").trim().length > 0;
  const hasAttachment = Boolean(this.attachment?.dataUrl && this.attachment?.kind && this.attachment?.mimeType);

  if (!hasContent && !hasAttachment) {
    this.invalidate("content", "Message content or attachment is required");
  }

  next();
});

module.exports = mongoose.model("Message", messageSchema);
