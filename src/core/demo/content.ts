// Invented people, companies and texts for the demo data. All domains end in .example.

export const OWNER = { name: 'Alex Morgan' };

export const DEMO_ACCOUNTS = [
  { email: 'alex.morgan@mailbox.example', displayName: 'Alex Morgan' },
  { email: 'alex.morgan@bluepeak.example', displayName: 'Alex Morgan' },
  { email: 'alex@morgan-family.example', displayName: 'Alex Morgan' },
] as const;

export const FIRST_NAMES = [
  'Anna',
  'Ben',
  'Carla',
  'David',
  'Elena',
  'Felix',
  'Greta',
  'Hugo',
  'Ines',
  'Jonas',
  'Karin',
  'Leo',
  'Mira',
  'Nils',
  'Olga',
  'Paul',
  'Rosa',
  'Simon',
  'Tessa',
  'Viktor',
  'Wanda',
  'Yusuf',
  'Zoe',
  'Marek',
  'Lina',
  'Tom',
  'Nora',
  'Emil',
  'Sara',
  'Oskar',
] as const;

export const LAST_NAMES = [
  'Berg',
  'Castell',
  'Dorn',
  'Ebner',
  'Falk',
  'Gruber',
  'Hartl',
  'Iversen',
  'Jansen',
  'Keller',
  'Lindqvist',
  'Moser',
  'Novak',
  'Ortega',
  'Petrov',
  'Quist',
  'Reiter',
  'Sandoval',
  'Thaler',
  'Urban',
  'Vogel',
  'Winter',
  'Zeller',
  'Brandt',
  'Fischer',
] as const;

export const COMPANY_DOMAINS = [
  'bluepeak.example',
  'larchmont.example',
  'harborfinch.example',
  'meridianlabs.example',
  'quillon.example',
  'northgate.example',
  'mailbox.example',
  'postfach.example',
] as const;

export const SERVICES = [
  { name: 'Bluepeak Build Server', address: 'builds@bluepeak.example' },
  { name: 'Ticket System', address: 'tickets@bluepeak.example' },
  { name: 'Calendar', address: 'calendar@bluepeak.example' },
  { name: 'Harbor & Finch Bank', address: 'service@harborfinch.example' },
  { name: 'Larchmont Parcel', address: 'tracking@larchmont.example' },
  { name: 'Northgate Energy', address: 'billing@northgate.example' },
] as const;

export const NEWSLETTERS = [
  { name: 'Quillon Weekly', address: 'weekly@quillon.example' },
  { name: 'Meridian Labs News', address: 'news@meridianlabs.example' },
  { name: 'The Larchmont Letter', address: 'letter@larchmont.example' },
  { name: 'Northgate Offers', address: 'offers@northgate.example' },
] as const;

export const WORK_SUBJECTS = [
  'Quarterly report draft',
  'Budget review for next year',
  'Notes from the planning meeting',
  'Website relaunch: open questions',
  'Contract renewal',
  'Feedback on the proposal',
  'Schedule for the release',
  'Offer for the new workstations',
  'Agenda for Thursday',
  'Summary of the customer call',
  'Onboarding plan for the new colleague',
  'Travel request for the conference',
  'Updated project timeline',
  'Invoice for October',
  'Security training reminder',
  'Design review results',
  'Server maintenance window',
  'Holiday planning for the team',
  'Minutes of the steering committee',
  'Open points before go-live',
] as const;

export const SERVICE_SUBJECTS = [
  'Build finished successfully',
  'Build failed on branch main',
  'Ticket assigned to you',
  'Ticket was closed',
  'Invitation: weekly sync',
  'Your statement is ready',
  'Your parcel is on its way',
  'Your monthly bill',
  'Password expires in 14 days',
  'New sign-in to your account',
] as const;

export const NEWSLETTER_SUBJECTS = [
  'This week: five things worth reading',
  'New features in the spring release',
  'Your monthly digest',
  'Save the date: user conference',
  'Tips for a tidy inbox',
  'What we learned this quarter',
  'Seasonal offers for members',
] as const;

export const PERSONAL_SUBJECTS = [
  'Dinner on Saturday?',
  'Photos from the weekend',
  'Birthday present for grandma',
  'Hiking trip in June',
  'Can you pick up the kids?',
  'Recipe you asked for',
  'Moving day: who can help?',
  'Concert tickets',
  'Greetings from the coast',
] as const;

export const JUNK_SUBJECTS = [
  'You have won a voucher',
  'Final notice about your delivery',
  'Earn money from home',
  'Your account needs verification',
  'Exclusive offer, today only',
] as const;

export const SENTENCES = [
  'I have attached the current version for you to look at.',
  'Could you give me your feedback by the end of the week?',
  'We should talk about this in the next meeting.',
  'The numbers look better than last month.',
  'Please let me know if anything is unclear.',
  'I checked the details again and everything fits.',
  'There are still two open questions on our side.',
  'Thanks for the quick answer, that helps a lot.',
  'The customer agreed to the new schedule.',
  'I will be out of the office on Friday.',
  'Let us keep the original plan for now.',
  'The first draft is ready, the second part follows tomorrow.',
  'Can we move the appointment by one hour?',
  'I forwarded your question to the right team.',
  'The update went through without any problems.',
  'We need a decision before the end of the month.',
  'Everything is prepared for the handover.',
  'I added my comments directly in the document.',
  'It was good to see everyone again last week.',
  'Do you have a few minutes for a short call?',
] as const;

export const ATTACHMENT_NAMES = [
  ['Quarterly report.pdf', 'application/pdf'],
  ['Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['Meeting notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['Offer.pdf', 'application/pdf'],
  ['Timeline.png', 'image/png'],
  ['Photo.jpg', 'image/jpeg'],
  ['Invoice.pdf', 'application/pdf'],
  ['Slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
] as const;
