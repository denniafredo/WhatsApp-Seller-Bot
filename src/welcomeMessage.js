const menuItems = [
  {
    label: 'Box Sterofoam / Cooler Box (Aluminium)',
    listTitle: 'Box Sterofoam',
    listDescription: 'Cooler Box aluminium',
    keyword: 'PL box',
  },
  {
    label: 'Box Sterofoam Lakban Warna-warni',
    listTitle: 'Box Warna-warni',
    listDescription: 'Price list Box Lakban warna-warni',
    keyword: 'PL box warna',
  },
  {
    label: 'Sterofoam Lembaran',
    listTitle: 'Sterofoam Lembaran',
    listDescription: 'Price list lembaran',
    keyword: 'PL Lembaran',
  },
  {
    label: 'Ice Pack',
    listTitle: 'Ice Pack',
    listDescription: 'Price list ice pack',
    keyword: 'PL Ice Pack',
  },
  {
    label: 'Ice Gel',
    listTitle: 'Ice Gel',
    listDescription: 'Price list ice gel',
    keyword: 'PL Ice Gel',
  },
  {
    label: 'Termal Bag / tas termal',
    listTitle: 'Termal Bag',
    listDescription: 'Price list Tas termal',
    keyword: 'PL Thermal Bag',
  },
  {
    label: 'PE Foam',
    listTitle: 'PE Foam',
    listDescription: 'Price list PE foam',
    keyword: 'PL PE foam',
  },
  {
    label: 'Lem Sterofoam',
    listTitle: 'Lem Sterofoam',
    listDescription: 'Price list lem sterofoam',
    keyword: 'PL Lem Sterofoam',
  },
  {
    label: 'Pemotong Sterofoam - Sterofoam Cutter',
    listTitle: 'Pemotong Sterofoam',
    listDescription: 'Price list Sterofoam Cutter',
    keyword: 'PL Pemotong Sterofoam',
  },
  {
    label: 'Palet Plastik',
    listTitle: 'Palet Plastik',
    listDescription: 'Price list palet plastik',
    keyword: 'PL Palet Plastik',
  },
];

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function createPrefilledWhatsAppLink(phoneNumber, text) {
  const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) {
    return null;
  }

  return `https://wa.me/${normalizedPhoneNumber}?text=${encodeURIComponent(text)}`;
}

function createWelcomeMessage(businessPhoneNumber) {
  const menuLines = menuItems.map((item) => {
    const link = createPrefilledWhatsAppLink(businessPhoneNumber, item.keyword);

    if (!link) {
      return `- ${item.label} (${item.keyword})`;
    }

    return `- ${item.label}\n  ${link}`;
  });

  return [
    'Terimakasih sudah menghubungi Dashmall - Sterofoam!',
    '',
    'Kami Sedia :',
    ...menuLines,
    '',
    'Ada yang bisa kami bantu?',
  ].join('\n');
}

function createWelcomeListOptions() {
  const menuLines = menuItems.map((item) => {
    return `- ${item.label}`;
  });
  return {
    buttonText: 'Lihat Produk',
    description: [
      'Terimakasih sudah menghubungi Dashmall - Sterofoam!',
      '',
      'Kami Sedia :',
      ...menuLines,
      '',
      'Ada yang bisa kami bantu?',
    ].join('\n'),
    sections: [
      {
        title: 'Pilih Price List',
        rows: menuItems.map((item) => ({
          rowId: item.keyword,
          title: item.listTitle,
          description: item.listDescription,
        })),
      },
    ],
  };
}

module.exports = {
  createWelcomeMessage,
  createWelcomeListOptions,
  menuItems,
};
