import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: process.env.ETHEREAL_HOST || "smtp.ethereal.email",
  port: Number(process.env.ETHEREAL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
  },
});

export async function sendEmail(params: {
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
}) {
  const info = await transporter.sendMail({
    from: params.fromEmail,
    to: params.toEmail,
    subject: params.subject,
    text: params.body,
  });

  // Ethereal gives back a preview URL — worth logging / surfacing
  // in the dashboard so you can prove delivery in the demo video.
  const previewUrl = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl };
}
