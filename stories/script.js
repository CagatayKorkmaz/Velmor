document.addEventListener('DOMContentLoaded', function() {
    const hikayeIcerik = document.getElementById('hikaye-icerik');
    const icindekilerListesi = document.getElementById('icindekiler-listesi');
    const toggleThemeButton = document.getElementById('toggle-theme');
    const body = document.body;
    const increaseFontButton = document.getElementById('increase-font');
    const decreaseFontButton = document.getElementById('decrease-font');
    
    let currentFontSize = 1.1; // CSS'deki paragraf font-size'ı ile aynı başlangıç değeri

    // İçindekiler listesini oluştur
    function generateTableOfContents() {
        icindekilerListesi.innerHTML = '';
        const headings = hikayeIcerik.querySelectorAll('h2, h3');
        headings.forEach(heading => {
            const listItem = document.createElement('li');
            const link = document.createElement('a');
            const targetId = heading.id;
            link.href = '#' + targetId;
            link.textContent = heading.textContent;
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({behavior: 'smooth',block: 'start'});
                }
            });
            if (heading.tagName === 'H3') {
                listItem.classList.add('sub-item');
            }
            listItem.appendChild(link);
            icindekilerListesi.appendChild(listItem);
        });
    }

    // Sayfa yüklendiğinde içindekileri oluştur
    generateTableOfContents();

    // Koyu/Açık Tema Değiştirme
    toggleThemeButton.addEventListener('click', function() {
        body.classList.toggle('dark-mode');
        body.classList.toggle('light-mode');
        // Buton metnini güncelle
        if (body.classList.contains('dark-mode')) {
            toggleThemeButton.innerHTML = '<i class="fa-solid fa-moon"></i>'; 
        } else {
            toggleThemeButton.innerHTML = '<i class="fa-solid fa-sun"></i>';
        }
    });

    // Yazı Tipi Boyutunu Artırma
    increaseFontButton.addEventListener('click', function() {
        currentFontSize += 0.1; // Her tıklamada 0.1em artır
        hikayeIcerik.style.fontSize = currentFontSize + 'em';
    });

    // Yazı Tipi Boyutunu Azaltma
    decreaseFontButton.addEventListener('click', function() {
        if (currentFontSize > 0.7) { // Minimum boyutu belirle
            currentFontSize -= 0.1; // Her tıklamada 0.1em azalt
            hikayeIcerik.style.fontSize = currentFontSize + 'em';
        }
    });
});

document.getElementById('print-pdf').addEventListener('click', function() {
    window.print();
});


document.querySelector(".icindekiler-kutusu h3").addEventListener("click", function() {
document.querySelector(".icindekiler-kutusu").classList.toggle("kapali");
});