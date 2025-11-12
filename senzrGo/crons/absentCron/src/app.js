export default {
  id: "absentCron",
  name: "Absent Crone Scheduling",
  icon: "auto_schedule",
  description: "Cron for Put Entry the Absent Users!",
  overview: () => [
    {
      label: "Shcheduling",
      text: "Cron for Put Entry the Absent Users!",
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
