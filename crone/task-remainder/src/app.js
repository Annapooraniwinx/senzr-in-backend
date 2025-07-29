// /src/app.js
export default {
  id: "dailytask",
  name: "Daily Task Report",
  icon: "attach_email",
  description: "Sends daily PDF task report to Admins of each tenant",
  overview: () => [
    {
      label: "Report",
      text: "Sends daily reports at 9 AM to tenant admins",
    },
  ],
  options: [
    {
      field: "text",
      name: "Text",
      type: "string",
      meta: {
        width: "full",
        interface: "input",
      },
    },
  ],
};
